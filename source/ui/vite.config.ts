import {defineConfig} from 'vite'
import vue from '@vitejs/plugin-vue'
import {fileURLToPath,URL} from 'node:url'
export default defineConfig({plugins:[vue()],resolve:{alias:{'@':fileURLToPath(new URL('./src',import.meta.url))}},build:{outDir:'dist',target:'esnext'},define:{'import.meta.env.VITE_CLIENT_ID':JSON.stringify('1501'),'import.meta.env.VITE_REDIRECT_URI':JSON.stringify('https://vatiris.se/'),'import.meta.env.VITE_VATSIM_AUTH_BASE_URI':JSON.stringify('https://auth.vatsim.net'),'import.meta.env.VITE_BACKEND_BASE_URL':JSON.stringify('https://backend.vatiris.se')}})
