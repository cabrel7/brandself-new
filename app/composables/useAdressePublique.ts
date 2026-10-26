/** Adresse publique d'une vitrine : hôte courant + username (domaine de production : décision #12). */
export function useAdressePublique(username: MaybeRefOrGetter<string | null | undefined>) {
  const url = useRequestURL()
  const nom = computed(() => toValue(username) ?? '')
  const affichee = computed(() => `${url.host}/${nom.value}`)
  const complete = computed(() => `${url.origin}/${nom.value}`)
  return { hote: url.host, affichee, complete }
}
