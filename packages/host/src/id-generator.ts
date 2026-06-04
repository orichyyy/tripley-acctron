export type IdGenerator = () => string;

export function createSequentialIdGenerator(prefix: string): IdGenerator {
  let nextId = 1;
  return () => `${prefix}-${nextId++}`;
}
