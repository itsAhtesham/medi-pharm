import { NextRequest } from 'next/server';
import { actor } from '@/server/session';
import { pool } from '@/server/db';
import { csvRow } from '@/lib/csv';
export const runtime = 'nodejs';
const exportsMap = {
  customers: { table: 'customers', columns: 'id,name,phone,age,notes,archived_at,created_at' },
  medicines: { table: 'medicines', columns: 'id,name,strength,form,archived_at,created_at' },
  purchases: {
    table: 'purchases',
    columns:
      'id,sequence,customer_id,purchase_date,notes,status,supply_model,reminder_enabled,supply_start,supply_days,run_out_date,refill_of_purchase_id,created_at',
  },
  items: {
    table: 'purchase_items',
    columns: 'id,purchase_id,medicine_id,name,strength,form,quantity,unit,position',
  },
  followups: {
    table: 'follow_ups',
    columns:
      'id,purchase_id,supply_id,customer_id,medicine_id,status,calculated_date,manual_date,next_date,last_contacted_at,closed_at,closed_reason,resolving_purchase_id',
  },
  supplies: {
    table: 'medicine_supplies',
    columns:
      'id,customer_id,purchase_id,medicine_id,included,supply_start,supply_days,mode,remaining_override,remaining_used,run_out_date,reminder_enabled,manual_date,created_at',
  },
  events: {
    table: 'follow_up_events',
    columns: 'id,follow_up_id,actor_id,action,note,before,after,created_at',
  },
} as const;
export async function GET(req: NextRequest) {
  const a = await actor();
  if (!a) return new Response('Sign in to export records.', { status: 401 });
  const kind = req.nextUrl.searchParams.get('kind') ?? '';
  if (!(kind in exportsMap)) return new Response('Unknown export', { status: 400 });
  const spec = exportsMap[kind as keyof typeof exportsMap];
  const client = await pool.connect();
  const encoder = new TextEncoder();
  let offset = 0,
    done = false;
  const finish = async () => {
    if (done) return;
    done = true;
    try {
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  };
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  } catch (error) {
    client.release();
    throw error;
  }
  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode('\uFEFF' + csvRow(spec.columns.split(','))));
    },
    async pull(controller) {
      try {
        const { rows } = await client.query(
          `SELECT ${spec.columns} FROM ${spec.table} WHERE pharmacy_id=$1 ORDER BY id LIMIT 500 OFFSET $2`,
          [a.pharmacyId, offset],
        );
        for (const row of rows)
          controller.enqueue(
            encoder.encode(csvRow(spec.columns.split(',').map((key) => row[key]))),
          );
        offset += rows.length;
        if (rows.length < 500) {
          await finish();
          controller.close();
        }
      } catch (error) {
        await finish();
        controller.error(error);
      }
    },
    async cancel() {
      await finish();
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="medi-pharm-${kind}.csv"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
