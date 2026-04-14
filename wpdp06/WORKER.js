/**
 * CloudFlare Worker - workshop.rodrigorosar.com.br
 * -----------------------------------------------------
 * Intercepta requisicoes e:
 *   - /wpdp06            -> menu A/B no GitHub Pages
 *   - /wpdp06-v1 a v5    -> landing A/B correspondente no GitHub Pages
 *   - qualquer outro     -> passa direto pro Lovable (origem original)
 *
 * URL no navegador NAO muda (proxy transparente, nao redirect).
 *
 * Deploy:
 *   1. CloudFlare > Workers & Pages > Create Application > Worker
 *   2. Nome: wpdp06-router
 *   3. Cola este codigo, salva
 *   4. Em Triggers > Custom Domains/Routes, adiciona:
 *        workshop.rodrigorosar.com.br/wpdp06*
 *      (o asterisco pega /wpdp06, /wpdp06-v1, /wpdp06-v2, etc)
 */

const GH_PAGES = 'https://metrik-group.github.io/wpdp-preview'

// Paths que o Worker deve servir a partir do GitHub Pages
const ROUTE_RE = /^\/(wpdp06(?:-v[1-5])?)\/?$/

export default {
  async fetch(request) {
    const url = new URL(request.url)
    const match = url.pathname.match(ROUTE_RE)

    if (!match) {
      // Nao e uma rota nossa -> passa direto (Lovable assume)
      return fetch(request)
    }

    // Monta URL de destino no GitHub Pages. Precisa do "/" final pra servir index.html.
    const slug = match[1]  // "wpdp06" ou "wpdp06-v3"
    const target = `${GH_PAGES}/${slug}/${url.search}`

    // Busca a pagina no GitHub Pages
    const ghResponse = await fetch(target, {
      headers: {
        'User-Agent': request.headers.get('User-Agent') || 'CF-Worker',
        'Accept': request.headers.get('Accept') || 'text/html',
      },
    })

    // Retorna o HTML direto, ajustando Cache-Control pra permitir atualizacoes rapidas
    const newHeaders = new Headers(ghResponse.headers)
    newHeaders.set('Cache-Control', 'public, max-age=300')  // 5 min
    newHeaders.set('X-Served-By', 'cf-worker-wpdp06-router')

    return new Response(ghResponse.body, {
      status: ghResponse.status,
      statusText: ghResponse.statusText,
      headers: newHeaders,
    })
  },
}
