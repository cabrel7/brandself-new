import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const PROJECT_ROOT = path.resolve(import.meta.dirname, '../..')
const ECOSYSTEM_PATH = path.join(PROJECT_ROOT, 'ecosystem.config.cjs')
const NGINX_CACHE_PATH = path.join(PROJECT_ROOT, 'deploy/nginx/brandself-cache.conf')
const NGINX_LOCATION_PATH = path.join(PROJECT_ROOT, 'deploy/nginx/brandself-location.conf')

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
})
