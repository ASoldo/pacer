import { createApp } from 'vue'
import { createPinia } from 'pinia'
import 'leaflet/dist/leaflet.css'
import 'maplibre-gl/dist/maplibre-gl.css'
import './style.css'
import App from './App.vue'
import { useAppUpdate } from './composables/useAppUpdate'

useAppUpdate().registerAppServiceWorker()

createApp(App).use(createPinia()).mount('#app')
