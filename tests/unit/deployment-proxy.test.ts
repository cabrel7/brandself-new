import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const PROJECT_ROOT = path.resolve(import.meta.dirname, '../..')
const ECOSYSTEM_PATH = path.join(PROJECT_ROOT, 'ecosystem.config.cjs')
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
})
