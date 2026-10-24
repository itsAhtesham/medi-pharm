'use client';

import { useEffect, useRef, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { formatDate, isDate, pharmacyToday } from '@/lib/dates';
import { Button } from './button';
import { Calendar } from './calendar';
import { Popover, PopoverContent, PopoverTrigger } from './popover';

// Calendar widgets use local Date objects; form values remain date-only strings.
function calendarDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function DatePicker({
  id,
  name,
  defaultValue = '',
  value: controlledValue,
  onValueChange,
  min,
  max,
  disabled = false,
  required = false,
}: {
  id: string;
  name?: string;
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
  required?: boolean;
}) {
  const [internalValue, setInternalValue] = useState(defaultValue);
  const value = controlledValue ?? internalValue;
  const validationRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [showError, setShowError] = useState(false);
  const [open, setOpen] = useState(false);
  const today = calendarDate(pharmacyToday());
  const selected = isDate(value) ? calendarDate(value) : undefined;
  const validMin = min && isDate(min) ? min : undefined;
  const validMax = max && isDate(max) ? max : undefined;
  const error = !value
    ? required
      ? 'Select a date.'
      : ''
    : !isDate(value)
      ? 'Select a valid date.'
      : validMin && value < validMin
        ? `Select ${formatDate(validMin)} or later.`
        : validMax && value > validMax
          ? `Select ${formatDate(validMax)} or earlier.`
          : '';

  useEffect(() => {
    validationRef.current?.setCustomValidity(error);
  }, [error]);

  useEffect(() => {
    const form = validationRef.current?.form;
    const reset = () => {
      setInternalValue(defaultValue);
      setShowError(false);
      setOpen(false);
    };
    form?.addEventListener('reset', reset);
    return () => form?.removeEventListener('reset', reset);
  }, [defaultValue]);

  function selectValue(next: string) {
    setInternalValue(next);
    onValueChange?.(next);
    setShowError(false);
    setOpen(false);
  }

  return (
    <>
      {/* Retain native form submission and constraint validation without a native date UI. */}
      <input
        ref={validationRef}
        type="text"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        name={name}
        value={value}
        required={required}
        disabled={disabled}
        onChange={() => {}}
        onInvalid={(event) => {
          event.preventDefault();
          setShowError(true);
          triggerRef.current?.focus();
        }}
      />
      <Popover open={open && !disabled} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            ref={triggerRef}
            type="button"
            disabled={disabled}
            aria-invalid={showError && !!error}
            aria-describedby={showError && error ? `${id}-error` : undefined}
            variant="outline"
            className="h-11 w-full justify-between font-normal"
          >
            {selected ? formatDate(value) : 'Select date'}
            <CalendarDays aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-0" aria-label="Choose date">
          <Calendar
            mode="single"
            required
            autoFocus
            today={today}
            selected={selected}
            defaultMonth={
              selected ??
              (validMin
                ? calendarDate(validMin)
                : validMax && pharmacyToday() > validMax
                  ? calendarDate(validMax)
                  : today)
            }
            disabled={[
              ...(validMin ? [{ before: calendarDate(validMin) }] : []),
              ...(validMax ? [{ after: calendarDate(validMax) }] : []),
            ]}
            onSelect={(date) => {
              selectValue(
                `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
              );
            }}
          />
          {!required && value && (
            <div className="border-t p-2">
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={() => selectValue('')}
              >
                Clear date
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>
      {showError && error && (
        <p id={`${id}-error`} className="text-sm text-red-700" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
