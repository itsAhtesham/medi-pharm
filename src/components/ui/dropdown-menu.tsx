'use client';
import * as Menu from '@radix-ui/react-dropdown-menu';
export const DropdownMenu = Menu.Root;
export const DropdownMenuTrigger = Menu.Trigger;
export function DropdownMenuContent(props: React.ComponentProps<typeof Menu.Content>) {
  return (
    <Menu.Portal>
      <Menu.Content
        sideOffset={6}
        className="z-40 min-w-44 rounded-xl border bg-white p-1.5 shadow-lg"
        {...props}
      />
    </Menu.Portal>
  );
}
export function DropdownMenuItem(props: React.ComponentProps<typeof Menu.Item>) {
  return (
    <Menu.Item
      className="flex w-full cursor-pointer items-center rounded-lg px-3 py-2 text-sm outline-none focus:bg-secondary data-[disabled]:opacity-40"
      {...props}
    />
  );
}
