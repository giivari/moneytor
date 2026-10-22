"use client";

import { useId } from "react";

/** A small, keyboard-native choice group for stable option sets. */
export function CompactChoice<Value extends string>({ label, value, options, onChange, required = false, disabled = false }: {
  label: string; value?: Value; options: readonly { value: Value; label: string }[];
  onChange: (value: Value) => void; required?: boolean; disabled?: boolean;
}) {
  const id = useId();
  return <div className="field"><span id={id}>{label}</span>
    <div className="compact-choice" role="radiogroup" aria-labelledby={id}>
      {options.map((option) => <label className="compact-choice-option" key={option.value}>
        <input type="radio" name={id} value={option.value} checked={value === option.value} required={required}
          disabled={disabled} onChange={() => onChange(option.value)} />
        <span>{option.label}</span>
      </label>)}
    </div>
  </div>;
}
