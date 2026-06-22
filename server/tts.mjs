import { spawn } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import https from 'node:https'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import cors from 'cors'
import express from 'express'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const distDir = path.join(rootDir, 'dist')
const port = Number(process.env.PORT ?? process.env.TTS_PORT ?? 5174)
const piperBin = process.env.PIPER_BIN ?? process.env.CODEX_NOTIFY_PIPER_BIN ?? '/usr/bin/piper-tts'
const piperModel =
  process.env.PIPER_MODEL ??
  process.env.CODEX_NOTIFY_PIPER_MODEL ??
  '/home/rootster/documents/codex/Automation/models/piper/en_US-ryan-high.onnx'
const piperConfig =
  process.env.PIPER_CONFIG ??
  process.env.CODEX_NOTIFY_PIPER_CONFIG ??
  '/home/rootster/documents/codex/Automation/models/piper/en_US-ryan-high.onnx.json'
const piperVoiceDir = process.env.PIPER_VOICE_DIR ?? path.dirname(piperModel)
const tlsPort = Number(process.env.TLS_PORT ?? 8443)
const tlsCertPath = process.env.TLS_CERT_PATH
const tlsKeyPath = process.env.TLS_KEY_PATH
const app = express()
const weatherCache = new Map()
const weatherCacheMaxAgeMs = 5 * 60 * 1000
const upstreamTimeoutMs = 12_000

app.use(cors())
app.use(express.json({ limit: '8kb' }))
app.use((_request, response, next) => {
  response.setHeader('Permissions-Policy', 'geolocation=(self), serial=(self), bluetooth=(self)')
  next()
})

function clean(value) {
  return String(value ?? '').trim()
}

app.post('/api/client-log', (request, response) => {
  const scope = clean(request.body?.scope).slice(0, 40) || 'client'
  const entries = Array.isArray(request.body?.entries) ? request.body.entries.slice(0, 20) : []

  for (const entry of entries) {
    const level = clean(entry?.level).slice(0, 12) || 'info'
    const at = clean(entry?.at).slice(0, 40) || new Date().toISOString()
    const message = clean(entry?.message).replace(/\s+/g, ' ').slice(0, 500)
    if (message) console.log(`[client:${scope}] ${at} ${level}: ${message}`)
  }

  response.status(204).end()
})

function compact(values, separator = ' ') {
  return values.map(clean).filter(Boolean).join(separator)
}

function rawWarningText(record) {
  const warnings = []
  const errorCode = clean(record.ErrorCode)
  const errorText = clean(record.ErrorText)
  const additionalErrorText = clean(record.AdditionalErrorText)

  if (errorCode && errorCode !== '0' && errorText) warnings.push(errorText)
  if (additionalErrorText) warnings.push(additionalErrorText)
  if (clean(record.SuggestedVIN)) warnings.push(`Suggested VIN pattern: ${record.SuggestedVIN}`)
  if (clean(record.PossibleValues)) warnings.push(`Possible values: ${record.PossibleValues}`)

  return warnings
}

function hasCoreDecode(record) {
  return Boolean(clean(record.Make) || clean(record.Manufacturer) || clean(record.ModelYear))
}

function isLimitedEuropeanVin(record, rawWarnings) {
  const vin = clean(record.VIN)
  const manufacturer = clean(record.Manufacturer).toLowerCase()
  const plantCountry = clean(record.PlantCountry).toLowerCase()
  const text = rawWarnings.join(' ').toLowerCase()

  return (
    hasCoreDecode(record) &&
    (vin.startsWith('WMW') || manufacturer.includes('bmw') || plantCountry.includes('england')) &&
    (text.includes('invalid character') || text.includes('model year warning') || text.includes('check digit'))
  )
}

function decodeConfidence(record, rawWarnings) {
  if (rawWarnings.length === 0) return 'decoded'
  if (isLimitedEuropeanVin(record, rawWarnings)) return 'limited'
  return 'review'
}

function warningText(record, rawWarnings) {
  if (isLimitedEuropeanVin(record, rawWarnings)) {
    return [
      'Limited NHTSA decode for this European-market MINI/BMW VIN. Public fields were partially decoded; confirm model, trim, chassis, and engine from registration or OBD.',
    ]
  }

  return rawWarnings
}

const miniTypeCodeFields = {
  XT71: {
    make: 'MINI',
    model: 'Cooper SD',
    generation: 'Gen 3',
    chassis: 'F55',
    bodyStyle: '5-door hatch',
    engine: 'B47C20O0 2.0 diesel, 125 kW / 170 hp',
    fuelType: 'Diesel',
    driveType: 'Front-wheel drive',
    imageUrl: '/vehicles/mini-f55-cooper-sd.png',
    avatarUrl: '/vehicles/mini-f55-cooper-sd-avatar.png',
  },
  XT72: {
    make: 'MINI',
    model: 'Cooper SD',
    generation: 'Gen 3',
    chassis: 'F55',
    bodyStyle: '5-door hatch',
    engine: 'B47C20O0 2.0 diesel, 125 kW / 170 hp',
    fuelType: 'Diesel',
    driveType: 'Front-wheel drive',
    imageUrl: '/vehicles/mini-f55-cooper-sd.png',
    avatarUrl: '/vehicles/mini-f55-cooper-sd-avatar.png',
  },
}

const knownVinFields = {
  WMWXT710702C58288: {
    make: 'MINI',
    model: 'Cooper SD',
    trim: 'Austin Seven Special Edition',
    modelYear: '2017',
    generation: 'Gen 3',
    chassis: 'F55',
    bodyStyle: '5-door hatch',
    engine: 'B47C20O0 2.0 diesel, 125 kW / 170 hp',
    fuelType: 'Diesel',
    driveType: 'Front-wheel drive',
    imageUrl: '/vehicles/mini-f55-cooper-sd.png',
    avatarUrl: '/vehicles/mini-f55-cooper-sd-avatar.png',
  },
}

function miniTypeCodeFromVin(vin) {
  return clean(vin).toUpperCase().slice(3, 7)
}

function miniTypeFields(vin) {
  const cleanVin = clean(vin).toUpperCase()
  return knownVinFields[cleanVin] ?? miniTypeCodeFields[miniTypeCodeFromVin(cleanVin)] ?? {}
}

function mergeFields(primary, fallback) {
  return Object.fromEntries(
    [...new Set([...Object.keys(primary), ...Object.keys(fallback)])].map((key) => [
      key,
      clean(primary[key]) || clean(fallback[key]),
    ]),
  )
}

function vehicleFields(record) {
  const engineParts = [
    record.EngineManufacturer,
    record.EngineModel,
    record.DisplacementL ? `${record.DisplacementL} L` : '',
    record.EngineCylinders ? `${record.EngineCylinders} cyl` : '',
  ]

  const nhtsaFields = {
    vin: clean(record.VIN),
    make: clean(record.Make),
    model: clean(record.Model),
    trim: clean(record.Trim || record.Trim2 || record.Series || record.Series2),
    modelYear: clean(record.ModelYear),
    bodyStyle: clean(record.BodyClass),
    engine: compact(engineParts),
    fuelType: clean(record.FuelTypePrimary),
    driveType: clean(record.DriveType),
    transmission: compact([record.TransmissionSpeeds, record.TransmissionStyle]),
    plant: compact([record.PlantCity, record.PlantState, record.PlantCountry], ', '),
  }

  return mergeFields(nhtsaFields, miniTypeFields(record.VIN))
}

function localVinDecode(vin, modelYear, reason = '') {
  const localFields = miniTypeFields(vin)
  if (Object.keys(localFields).length === 0) return null

  return {
    provider: 'Local MINI type-code fallback',
    vin,
    confidence: 'limited',
    fields: {
      ...localFields,
      vin,
      modelYear: clean(localFields.modelYear) || modelYear,
    },
    warnings: [
      reason
        ? `NHTSA vPIC unavailable (${reason}); using local MINI type-code data. Confirm trim and options from registration or OBD.`
        : 'Using local MINI type-code data. Confirm trim and options from registration or OBD.',
    ],
  }
}

app.get('/api/vin/:vin', async (request, response) => {
  const vin = clean(request.params.vin).toUpperCase().replace(/[^A-Z0-9]/g, '')
  const modelYear = clean(request.query.modelyear)

  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) {
    response.status(400).json({ error: 'VIN must be 17 characters and cannot contain I, O, or Q.' })
    return
  }

  const url = new URL(`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValuesExtended/${encodeURIComponent(vin)}`)
  url.searchParams.set('format', 'json')
  if (/^\d{4}$/.test(modelYear)) url.searchParams.set('modelyear', modelYear)

  try {
    const upstream = await fetch(url, { headers: { accept: 'application/json' } })
    if (!upstream.ok) {
      response.status(502).json({ error: `VIN decoder returned ${upstream.status}` })
      return
    }

    const payload = await upstream.json()
    const record = Array.isArray(payload.Results) ? payload.Results[0] : null
    if (!record) {
      const fallback = localVinDecode(vin, modelYear, 'no upstream result')
      if (fallback) {
        response.setHeader('Cache-Control', 'no-store')
        response.json(fallback)
        return
      }

      response.status(404).json({ error: 'VIN decoder returned no result.' })
      return
    }

    const rawWarnings = rawWarningText(record)
    const warnings = warningText(record, rawWarnings)
    response.setHeader('Cache-Control', 'no-store')
    response.json({
      provider: 'NHTSA vPIC',
      vin: clean(record.VIN) || vin,
      confidence: decodeConfidence(record, rawWarnings),
      fields: vehicleFields(record),
      warnings,
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'VIN decoder is unavailable'
    const fallback = localVinDecode(vin, modelYear, reason)
    if (fallback) {
      response.setHeader('Cache-Control', 'no-store')
      response.json(fallback)
      return
    }

    response.status(502).json({
      error: reason,
    })
  }
})

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function espeakArgs({ text, rate = 1, pitch = 1 }) {
  const wordsPerMinute = Math.round(clamp(rate, 0.65, 1.7) * 165)
  const pitchValue = Math.round(clamp(pitch, 0.45, 1.5) * 50)
  return ['--stdout', '-v', 'en-us', '-s', String(wordsPerMinute), '-p', String(pitchValue), text]
}

function voiceNameFromId(id) {
  const stem = id.replace(/\.onnx$/, '')
  const parts = stem.split('-')
  const voiceName = parts.slice(1).join(' ') || stem

  return voiceName
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .replace(/\s+/g, ' ')
}

function voiceLangFromId(id) {
  const [lang = 'en_US'] = id.replace(/\.onnx$/, '').split('-')
  return lang.replace('_', '-')
}

function listPiperVoices() {
  if (!existsSync(piperVoiceDir)) return []

  const files = readdirSync(piperVoiceDir)
  const models = files.filter((file) => file.endsWith('.onnx'))
  const voices = models
    .filter((file) => files.includes(`${file}.json`))
    .sort((first, second) => first.localeCompare(second))
    .map((file) => ({
      voiceURI: `piper:${file}`,
      name: voiceNameFromId(file),
      lang: voiceLangFromId(file),
      backend: 'piper',
      model: path.join(piperVoiceDir, file),
      config: path.join(piperVoiceDir, `${file}.json`),
      default: path.resolve(path.join(piperVoiceDir, file)) === path.resolve(piperModel),
    }))

  return voices.sort((first, second) => Number(second.default) - Number(first.default))
}

function resolvePiperVoice(voiceURI) {
  const voices = listPiperVoices()
  const fallback = voices.find((voice) => voice.default) ?? voices[0]

  if (!voiceURI) return fallback

  const requestedFile = path.basename(String(voiceURI).replace(/^piper:/, ''))
  return voices.find((voice) => voice.voiceURI === `piper:${requestedFile}`) ?? fallback
}

function piperArgs({ rate = 1, pitch = 1, voiceURI = '' }) {
  const lengthScale = (1 / clamp(rate, 0.65, 1.55)).toFixed(2)
  const noiseScale = clamp(0.5 + (pitch - 1) * 0.18, 0.35, 0.8).toFixed(2)
  const voice = resolvePiperVoice(voiceURI)

  if (!voice) {
    throw new Error('No Piper voices are available')
  }

  return [
    '--model',
    voice.model,
    '--config',
    voice.config,
    '--output_file',
    '-',
    '--length_scale',
    lengthScale,
    '--noise_scale',
    noiseScale,
    '--sentence_silence',
    '0.08',
    '--quiet',
  ]
}

function collectCommand(command, args, input) {
  return new Promise((resolve, reject) => {
    const chunks = []
    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stderr = ''

    child.stdout.on('data', (chunk) => chunks.push(chunk))
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `${command} exited with ${code}`))
        return
      }

      resolve(Buffer.concat(chunks))
    })

    child.stdin.end(input)
  })
}

async function synthesizeWithPiper(text, settings) {
  const voice = resolvePiperVoice(settings.voiceURI)
  if (!existsSync(piperBin) || !voice || !existsSync(voice.model) || !existsSync(voice.config)) {
    throw new Error('Piper binary or voice model is missing')
  }

  return collectCommand(piperBin, piperArgs(settings), `${text}\n`)
}

function synthesizeWithEspeak(text, settings) {
  return collectCommand('espeak-ng', espeakArgs({ text, ...settings }), '')
}

async function synthesize(text, settings) {
  try {
    const voice = resolvePiperVoice(settings.voiceURI)
    return {
      engine: 'piper',
      voiceURI: voice?.voiceURI ?? '',
      wav: await synthesizeWithPiper(text, settings),
    }
  } catch (error) {
    console.warn(`Piper TTS failed, falling back to espeak-ng: ${error instanceof Error ? error.message : error}`)
    return {
      engine: 'espeak-ng',
      voiceURI: '',
      wav: await synthesizeWithEspeak(text, settings),
    }
  }
}

app.get('/api/health', (_request, response) => {
  const voices = listPiperVoices()
  response.json({
    ok: true,
    preferredEngine: 'piper',
    fallbackEngine: 'espeak-ng',
    piperAvailable: existsSync(piperBin) && voices.length > 0,
    piperModel,
    voices: voices.map(({ model, config, ...voice }) => voice),
  })
})

app.get('/api/voices', (_request, response) => {
  const voices = listPiperVoices().map(({ model, config, ...voice }) => voice)
  response.json({ voices })
})

app.post('/api/tts', async (request, response) => {
  const text = String(request.body?.text ?? '').trim().slice(0, 240)

  if (!text) {
    response.status(400).json({ error: 'text is required' })
    return
  }

  try {
    const result = await synthesize(text, {
      rate: Number(request.body?.rate ?? 1),
      pitch: Number(request.body?.pitch ?? 1),
      voiceURI: String(request.body?.voiceURI ?? ''),
    })

    response.setHeader('Content-Type', 'audio/wav')
    response.setHeader('X-TTS-Engine', result.engine)
    if (result.voiceURI) response.setHeader('X-TTS-Voice', result.voiceURI)
    response.setHeader('Cache-Control', 'no-store')
    response.send(result.wav)
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : 'tts failed',
    })
  }
})

app.get('/api/geocode/search', async (request, response) => {
  const query = clean(request.query.q).slice(0, 160)
  const limit = Math.min(Math.max(Number(request.query.limit) || 6, 1), 8)

  if (query.length < 3) {
    response.json({ results: [] })
    return
  }

  const url = new URL('https://nominatim.openstreetmap.org/search')
  url.searchParams.set('q', query)
  url.searchParams.set('format', 'jsonv2')
  url.searchParams.set('addressdetails', '1')
  url.searchParams.set('limit', String(limit))
  url.searchParams.set('accept-language', 'en')

  try {
    const upstream = await fetch(url, {
      headers: {
        accept: 'application/json',
        'user-agent': 'RallyPacer/0.3.2 local-development',
      },
    })

    if (!upstream.ok) {
      response.status(502).json({ error: `Nominatim returned ${upstream.status}` })
      return
    }

    response.setHeader('Cache-Control', 'max-age=3600')
    response.json({ results: await upstream.json() })
  } catch (error) {
    response.status(502).json({ error: error instanceof Error ? error.message : 'Location search unavailable' })
  }
})

function coordinateList(value, min, max) {
  return String(value ?? '')
    .split(',')
    .map((entry) => Number(entry.trim()))
    .filter((entry) => Number.isFinite(entry) && entry >= min && entry <= max)
    .slice(0, 20)
}

app.get('/api/weather/route', async (request, response) => {
  const latitudes = coordinateList(request.query.latitude, -90, 90)
  const longitudes = coordinateList(request.query.longitude, -180, 180)

  if (latitudes.length === 0 || latitudes.length !== longitudes.length) {
    response.status(400).json({ error: 'matching latitude and longitude coordinate lists are required' })
    return
  }

  const url = new URL('https://api.open-meteo.com/v1/forecast')
  url.searchParams.set('latitude', latitudes.map((value) => value.toFixed(5)).join(','))
  url.searchParams.set('longitude', longitudes.map((value) => value.toFixed(5)).join(','))
  url.searchParams.set('current', [
    'temperature_2m',
    'relative_humidity_2m',
    'precipitation',
    'rain',
    'showers',
    'snowfall',
    'weather_code',
    'cloud_cover',
    'wind_speed_10m',
    'wind_direction_10m',
    'wind_gusts_10m',
  ].join(','))
  url.searchParams.set('wind_speed_unit', 'kmh')
  url.searchParams.set('precipitation_unit', 'mm')
  url.searchParams.set('timezone', 'auto')
  const cacheKey = `${url.searchParams.get('latitude')}|${url.searchParams.get('longitude')}`
  const cached = weatherCache.get(cacheKey)

  if (cached && Date.now() - cached.at < weatherCacheMaxAgeMs) {
    response.setHeader('Cache-Control', 'max-age=300')
    response.setHeader('X-Weather-Cache', 'hit')
    response.json(cached.payload)
    return
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), upstreamTimeoutMs)
  try {
    const upstream = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    })
    if (!upstream.ok) {
      if (cached) {
        response.setHeader('Cache-Control', 'max-age=60')
        response.setHeader('X-Weather-Cache', 'stale')
        response.json(cached.payload)
        return
      }

      response.status(502).json({ error: `Open-Meteo returned ${upstream.status}` })
      return
    }

    const payload = await upstream.json()
    weatherCache.set(cacheKey, { at: Date.now(), payload })
    response.setHeader('Cache-Control', 'max-age=300')
    response.setHeader('X-Weather-Cache', 'miss')
    response.json(payload)
  } catch (error) {
    if (cached) {
      response.setHeader('Cache-Control', 'max-age=60')
      response.setHeader('X-Weather-Cache', 'stale')
      response.json(cached.payload)
      return
    }

    response.status(502).json({ error: error instanceof Error ? error.message : 'Weather service unavailable' })
  } finally {
    clearTimeout(timeout)
  }
})

app.get('/api/road-alerts/route', (_request, response) => {
  response.setHeader('Cache-Control', 'max-age=120')
  response.json({
    source: 'hak',
    status: 'unconfigured',
    alerts: [],
  })
})

app.get('/version.json', (_request, response, next) => {
  response.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
  response.setHeader('Pragma', 'no-cache')
  next()
})

app.use(express.static(distDir))
app.use((request, response, next) => {
  if (request.method !== 'GET' || request.path.startsWith('/api')) {
    next()
    return
  }

  response.sendFile(path.join(distDir, 'index.html'))
})

app.listen(port, '0.0.0.0', () => {
  console.log(`rally-pacenotes server listening on ${port}`)
})

if (tlsCertPath && tlsKeyPath) {
  https
    .createServer(
      {
        cert: readFileSync(tlsCertPath),
        key: readFileSync(tlsKeyPath),
      },
      app,
    )
    .listen(tlsPort, '0.0.0.0', () => {
      console.log(`rally-pacenotes HTTPS server listening on ${tlsPort}`)
    })
}
