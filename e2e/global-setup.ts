import { execFileSync } from 'node:child_process'

// Les tests e2e lisent la vitrine de démonstration (dr-cabrel) : le seed est
// rejoué à chaque exécution, il est idempotent.
export default function globalSetup(): void {
  execFileSync('pnpm', ['db:seed'], { stdio: 'inherit' })
}
