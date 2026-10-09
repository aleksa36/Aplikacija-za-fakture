// node:sqlite je stabilan za našu upotrebu, ali Node ispisuje ExperimentalWarning pri učitavanju.
// Ovaj modul se uvozi prvi i utišava samo to upozorenje.
const original = process.emitWarning.bind(process);
process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
  const text = typeof warning === 'string' ? warning : warning.message;
  const type = typeof args[0] === 'string' ? args[0] : (args[0] as { type?: string } | undefined)?.type;
  if (type === 'ExperimentalWarning' && /SQLite/i.test(text)) return;
  return (original as (...a: unknown[]) => void)(warning, ...args);
}) as typeof process.emitWarning;
