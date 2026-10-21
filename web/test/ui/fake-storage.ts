// A Map-backed stand-in for window.localStorage (the three methods the page uses).
export function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string): string | null => data.get(key) ?? null,
    setItem: (key: string, value: string): void => void data.set(key, String(value)),
    removeItem: (key: string): void => void data.delete(key),
  };
}
