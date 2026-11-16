export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('fr-FR', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/**
 * A5 (D-A5-12) : fuseaux IANA connus du moteur (`Intl.supportedValuesOf`), pour proposer et contrôler les fuseaux d'un
 * pays. `UTC` n'y figure pas (et reste accepté par `isValidTimeZone`). Un fuseau déjà enregistré mais absent de cette
 * liste reste valide : le contrôle ne s'applique qu'au changement de valeur.
 */
export function listerFuseaux(): readonly string[] {
  return Intl.supportedValuesOf('timeZone')
}
