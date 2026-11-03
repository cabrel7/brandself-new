/** Accord en nombre : singulier pour 0 et 1 (usage français), pluriel au-delà. */
export function accorder(nombre: number, singulier: string, pluriel: string): string {
  return Math.abs(nombre) > 1 ? pluriel : singulier
}

/** « 1 heure », « 24 heures ». */
export function libelleHeures(nombre: number): string {
  return `${nombre} ${accorder(nombre, 'heure', 'heures')}`
}
