// S12 (#150) : source du sitemap des vitrines, consommée par @nuxtjs/sitemap.
// GET /api/__sitemap__/vitrines → { urls: [{ loc, lastmod }] }
import { defineEventHandler } from 'h3'
import { listerUrlsSitemap } from '#server/services/seo-sitemap'

export default defineEventHandler(async () => {
  const urls = await listerUrlsSitemap(new Date())
  return { urls }
})
