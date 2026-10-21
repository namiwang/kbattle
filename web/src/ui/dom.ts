// Small DOM helpers for the UI sections: plain elements, no framework.

type Props<K extends keyof HTMLElementTagNameMap> = Partial<Omit<HTMLElementTagNameMap[K], "style">>;

/** A new `tag` element with `props` assigned (as DOM properties) and `children` appended. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props<K> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const element = Object.assign(document.createElement(tag), props);
  element.append(...children);
  return element;
}

// The show* helpers write a value only when the field shows something else, so
// re-rendering after every keystroke keeps the caret and half-typed text ("1.", "-").

/** Shows `value` in a number input; NaN shows as empty. */
export function showNumber(input: HTMLInputElement, value: number): void {
  if (!Object.is(input.valueAsNumber, value)) input.value = Number.isFinite(value) ? String(value) : "";
}

export function showText(field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): void {
  if (field.value !== value) field.value = value;
}
