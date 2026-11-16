import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const PROJECT_ROOT = path.resolve(import.meta.dirname, '../..')
const ECOSYSTEM_PATH = path.join(PROJECT_ROOT, 'ecosystem.config.cjs')
const NGINX_CACHE_PATH = path.join(PROJECT_ROOT, 'deploy/nginx/brandself-cache.conf')
const NGINX_LOCATION_PATH = path.join(PROJECT_ROOT, 'deploy/nginx/brandself-location.conf')
const NGINX_DIR = path.join(PROJECT_ROOT, 'deploy/nginx')
const SECRET_EXAMPLE_PATH = path.join(NGINX_DIR, 'brandself-medias-secret.conf.exemple')
const VERIFY_SCRIPT_PATH = path.join(PROJECT_ROOT, 'deploy/verifier-cache-medias.sh')
const EXPLOITATION_DOC_PATH = path.join(PROJECT_ROOT, 'docs/exploitation-admin.md')
const SECRET_PLACEHOLDER = 'CHANGER-MOI'
const SECRET_FILE_PATH = '/etc/nginx/brandself-medias-secret.conf'

/** Supprime les lignes de commentaire nginx pour ne tester que les directives actives. */
function activeLines(source: string): string {
  return source.split('\n').filter(line => !/^\s*#/.test(line)).join('\n')
}

function mediasBlock(): string {
  const block = /^location\s+\/medias\/\s*\{([\s\S]*?)^\}/m.exec(readFileSync(NGINX_LOCATION_PATH, 'utf-8'))
  expect(block, 'location /medias/ must exist').not.toBeNull()
  return activeLines(block?.[1] ?? '')
}

describe('deployment reverse proxy', () => {
  it('should bind Nitro to the loopback interface', () => {
    const source = readFileSync(ECOSYSTEM_PATH, 'utf-8')

    expect(source).toMatch(/^\s*NITRO_HOST\s*:\s*['"]127\.0\.0\.1['"]\s*,?\s*$/m)
  })

  it('should provide the expected Nginx location with a single trusted forwarded IP', () => {
    expect(existsSync(NGINX_LOCATION_PATH), 'deploy/nginx/brandself-location.conf must exist').toBe(true)

    const source = readFileSync(NGINX_LOCATION_PATH, 'utf-8')
    expect(source).toMatch(/^\s*proxy_pass\s+http:\/\/127\.0\.0\.1:3000\s*;\s*$/m)
    expect(source).toMatch(/^\s*proxy_set_header\s+X-Forwarded-For\s+\$remote_addr\s*;\s*$/m)
    expect(source).not.toMatch(/^\s*(?!#)[^#;\r\n]*\$proxy_add_x_forwarded_for\b[^#;\r\n]*;\s*(?:#.*)?$/m)
  })

  it('should rate limit payment webhooks per IP with a 429 status', () => {
    const location = readFileSync(NGINX_LOCATION_PATH, 'utf-8')
    const cache = readFileSync(NGINX_CACHE_PATH, 'utf-8')

    // Zone déclarée au niveau http (fichier d'inclusion http), clé par IP binaire.
    expect(cache).toMatch(/^limit_req_zone\s+\$binary_remote_addr\s+zone=brandself_webhooks:\d+m\s+rate=10r\/s\s*;\s*$/m)

    const block = /^location\s+\^~\s+\/api\/webhooks\/\s*\{([\s\S]*?)^\}/m.exec(location)
    expect(block, 'location ^~ /api/webhooks/ must exist').not.toBeNull()
    const body = block?.[1] ?? ''
    expect(body).toMatch(/^\s*limit_req\s+zone=brandself_webhooks\s+burst=20\s+nodelay\s*;\s*$/m)
    expect(body).toMatch(/^\s*limit_req_status\s+429\s*;\s*$/m)
    expect(body).toMatch(/^\s*limit_req_log_level\s+warn\s*;\s*$/m)
    expect(body).toMatch(/^\s*proxy_set_header\s+X-Forwarded-For\s+\$remote_addr\s*;\s*$/m)
  })

  describe('medias cache refresh (hidden storefront images)', () => {
    it('should bypass the cache only through a map equal to the exact secret, with no default bypass', () => {
      const body = mediasBlock()
      expect(body).toMatch(/^\s*proxy_cache_bypass\s+\$bs_medias_refresh\s*;\s*$/m)

      const example = activeLines(readFileSync(SECRET_EXAMPLE_PATH, 'utf-8'))
      expect(example).toMatch(/^map\s+\$http_x_cache_refresh\s+\$bs_medias_refresh\s*\{/m)
      expect(example).toMatch(/^\s*default\s+0\s*;\s*$/m)
      // Une seule entrée qui bypasse, valeur exacte entre guillemets (pas d'expression régulière).
      const ones = [...example.matchAll(/^\s*(\S+)\s+1\s*;\s*$/gm)].map(match => match[1])
      expect(ones).toEqual([`"${SECRET_PLACEHOLDER}"`])
      expect(example).not.toMatch(/^\s*~/m)
      expect(example).not.toMatch(/^\s*default\s+(?!0\b)/m)
    })

    it('should cache the 404 for one minute so it replaces the old 200', () => {
      const body = mediasBlock()
      expect(body).toMatch(/^\s*proxy_cache_valid\s+200\s+1y\s*;\s*$/m)
      expect(body).toMatch(/^\s*proxy_cache_valid\s+404\s+1m\s*;\s*$/m)
      // Sans cela, le `no-store` du 404 applicatif empêcherait l'enregistrement.
      expect(body).toMatch(/^\s*proxy_ignore_headers\s+[^;]*\bCache-Control\b[^;]*;\s*$/m)
      // Le bypass ne doit pas empêcher d'enregistrer la réponse.
      expect(body).not.toMatch(/proxy_no_cache/)
    })

    it('should limit immutable to 200 responses through a status map', () => {
      const body = mediasBlock()
      expect(body).not.toMatch(/add_header\s+Cache-Control\s+"[^"]*"/i)
      expect(body).toMatch(/^\s*add_header\s+Cache-Control\s+\$bs_medias_cache_control\s+always\s*;\s*$/m)

      const cache = activeLines(readFileSync(NGINX_CACHE_PATH, 'utf-8'))
      const map = /^map\s+\$status\s+\$bs_medias_cache_control\s*\{([\s\S]*?)^\}/m.exec(cache)
      expect(map, 'map $status $bs_medias_cache_control must exist').not.toBeNull()
      const mapBody = map?.[1] ?? ''
      expect(mapBody).toMatch(/^\s*default\s+""\s*;\s*$/m)
      const withImmutable = [...mapBody.matchAll(/^\s*(\S+)\s+"[^"]*immutable[^"]*"\s*;\s*$/gm)].map(match => match[1])
      expect(withImmutable.length).toBeGreaterThan(0)
      for (const status of withImmutable) expect(['200', '304']).toContain(status)
      expect(mapBody).not.toMatch(/\b404\b/)
    })

    it('should never forward nor log the refresh header and keep a visible cache status', () => {
      const body = mediasBlock()
      expect(body).toMatch(/^\s*proxy_set_header\s+X-Cache-Refresh\s+""\s*;\s*$/m)
      expect(body).toMatch(/^\s*add_header\s+X-Cache-Status\s+\$upstream_cache_status\s+always\s*;\s*$/m)

      for (const file of readdirSync(NGINX_DIR)) {
        const source = activeLines(readFileSync(path.join(NGINX_DIR, file), 'utf-8'))
        if (/log_format/.test(source)) expect(source, `${file} log_format`).not.toMatch(/x_cache_refresh/i)
        if (file !== path.basename(SECRET_EXAMPLE_PATH)) {
          expect(source, `${file} must not read the header outside the secret map`).not.toMatch(/\$http_x_cache_refresh/)
        }
      }
    })

    it('should include the secret file without optional glob so nginx -t fails when it is missing', () => {
      const cache = activeLines(readFileSync(NGINX_CACHE_PATH, 'utf-8'))
      const includes = [...cache.matchAll(/^\s*include\s+([^;]+);\s*$/gm)].map(match => match[1]?.trim())
      expect(includes).toContain(SECRET_FILE_PATH)
      expect(includes.filter(target => target?.includes('secret'))).toEqual([SECRET_FILE_PATH])
      expect(cache).not.toMatch(/include\s+[^;]*[*?[]/)
    })

    it('should commit no secret value, only the placeholder', () => {
      const example = readFileSync(SECRET_EXAMPLE_PATH, 'utf-8')
      expect(example).toContain(SECRET_PLACEHOLDER)
      expect(example).toMatch(/openssl rand -hex 32/)
      expect(example).toMatch(/MEDIAS_CACHE_REFRESH_SECRET/)
      expect(example).toMatch(/chmod 640/)

      const sources = [
        ...readdirSync(NGINX_DIR).map(file => path.join(NGINX_DIR, file)),
        VERIFY_SCRIPT_PATH,
        EXPLOITATION_DOC_PATH,
      ]
      for (const file of sources) {
        const source = readFileSync(file, 'utf-8')
        // Toute valeur littérale d'en-tête ou de variable doit être le marqueur, une référence ou un gabarit.
        for (const match of source.matchAll(/X-Cache-Refresh:\s*(\S+)/g)) {
          expect(match[1], `${file} X-Cache-Refresh literal`).toMatch(/^(?:["']?\$|<|%s|mauvais-|CHANGER-MOI)/)
        }
        for (const match of source.matchAll(/MEDIAS_CACHE_REFRESH_SECRET=([^\s"']*)/g)) {
          expect(match[1], `${file} MEDIAS_CACHE_REFRESH_SECRET literal`).toMatch(/^(?:<[^>]+>|\$.*|CHANGER-MOI|)$/)
        }
        expect(source, `${file} hex secret of 64 chars`).not.toMatch(/\b[0-9a-f]{64}\b/)
        if (file.endsWith('.conf.exemple') || file.endsWith('.conf')) {
          for (const match of source.matchAll(/^\s*"([^"]+)"\s+1\s*;/gm)) {
            expect(match[1], `${file} map value`).toBe(SECRET_PLACEHOLDER)
          }
        }
      }
    })

    it('should provide a strict verification script with no hard-coded secret', () => {
      const script = readFileSync(VERIFY_SCRIPT_PATH, 'utf-8')
      expect(script).toMatch(/^set -euo pipefail$/m)
      expect(script).toMatch(/MEDIAS_CACHE_REFRESH_SECRET/)
      expect(script).toMatch(/X-Cache-Refresh/)
      expect(script).toMatch(/immutable/)
    })
  })
})
