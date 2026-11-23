import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

function restrictCloudflareVisitorRoutes(): Plugin {
  return {
    name: 'restrict-cloudflare-visitor-routes',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (!request.headers['cf-connecting-ip']) {
          next()
          return
        }

        const path = new URL(request.url ?? '/', 'http://localhost').pathname
        if (
          /^\/session\/[^/]+\/?$/.test(path)
          || path.startsWith('/api/')
          || path.startsWith('/uploads/')
          || path.startsWith('/assets/')
          || path === '/NFRDI.png'
          || path === '/@vite/client'
          || path === '/@react-refresh'
          || path.startsWith('/@id/')
          || path.startsWith('/src/')
          || path.startsWith('/node_modules/')
        ) {
          next()
          return
        }

        response.statusCode = 404
        response.end()
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), restrictCloudflareVisitorRoutes()],
  server: {
    port: Number(process.env.IDEA_WEB_PORT ?? 5173),
    allowedHosts: ['.trycloudflare.com'],
    proxy: {
      '/api': 'http://127.0.0.1:3001',
      '/uploads': 'http://127.0.0.1:3001',
    },
  },
})
