import { readFileSync } from 'node:fs'

import { expect, test, type Page } from '@playwright/test'

const packageJson = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as { version: string }

async function buildDemoRoute(page: Page) {
  await page.goto('/')
  await selectStagePanel(page, /^route$/i)
  await page.getByRole('button', { name: /build route/i }).click()
  await page.waitForFunction(
    () =>
      !Array.from(document.querySelectorAll('button')).some((button) => button.textContent?.includes('Building')) &&
      (
        document.querySelectorAll('.leaflet-overlay-pane path').length > 0 ||
        !document.querySelector<HTMLButtonElement>('[data-testid="drive-fab"]')?.disabled
      ),
    null,
    { timeout: 45_000 },
  )
}

async function selectMainPanel(page: Page, name: RegExp) {
  await page.getByTestId('app-shell').waitFor({ state: 'visible' })
  const desktopTab = page.getByTestId('desktop-editor-tabs').getByRole('tab', { name })
  const viewport = page.viewportSize()
  if ((viewport?.width ?? 0) >= 1024) {
    await desktopTab.waitFor({ state: 'visible' })
    await desktopTab.click()
    return
  }

  if (await desktopTab.isVisible().catch(() => false)) {
    await desktopTab.click()
    return
  }

  const dockButton = page.getByTestId('mobile-editor-dock').getByRole('button', { name })
  if (await dockButton.isVisible().catch(() => false)) {
    await dockButton.click()
    return
  }

  await page.getByTestId('mobile-menu-button').click()
  await page.getByTestId('mobile-app-drawer').getByRole('button', { name }).click()
}

async function selectStagePanel(page: Page, name: RegExp) {
  await selectMainPanel(page, /^stage$/i)
  const stageTab = page.getByTestId('stage-subnav').getByRole('tab', { name })
  await expect(stageTab).toBeVisible()
  await stageTab.click()
}

async function startSimulation(page: Page) {
  let playButton = page.locator('button[title="Play or pause"]:visible')
  if ((await playButton.count()) === 0) {
    await selectStagePanel(page, /shakedown/i)
    playButton = page.locator('button[title="Play or pause"]:visible')
  }
  await playButton.click()
  await page.waitForTimeout(600)
}

async function setSimulationSpeed(page: Page, speedKph: number) {
  let speedSlider = page.locator('input[title="Simulation speed"]')
  if ((await speedSlider.count()) === 0) {
    await selectStagePanel(page, /shakedown/i)
    speedSlider = page.locator('input[title="Simulation speed"]')
  }

  await speedSlider.evaluate((element, value) => {
    const input = element as HTMLInputElement
    input.value = String(value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }, speedKph)
}

async function setSimulationDistance(page: Page, distanceMeters: number) {
  let distanceRange = page.getByTestId('simulation-distance')
  if ((await distanceRange.count()) === 0) {
    await selectStagePanel(page, /shakedown/i)
    distanceRange = page.getByTestId('simulation-distance')
  }

  await expect(distanceRange).toBeVisible()

  const thumb = distanceRange.locator('[role="slider"]').first()
  if ((await thumb.count()) > 0) {
    const min = Number(await thumb.getAttribute('aria-valuemin') ?? 0)
    const max = Number(await thumb.getAttribute('aria-valuemax') ?? distanceMeters)
    const target = Math.min(Math.max(distanceMeters, min), max)
    const ratio = max === min ? 0 : (target - min) / (max - min)
    const box = await distanceRange.boundingBox()
    if (!box) throw new Error('Simulation distance slider is not measurable')

    await page.mouse.click(box.x + box.width * ratio, box.y + box.height / 2)
    await page.waitForFunction(
      ({ expected, tolerance }) => {
        const slider = document.querySelector<HTMLElement>('[data-testid="simulation-distance"] [role="slider"]')
        return Math.abs(Number(slider?.getAttribute('aria-valuenow') ?? Number.NaN) - expected) <= tolerance
      },
      {
        expected: target,
        tolerance: Math.max(12, (max - min) * 0.01),
      },
    )
    return
  }

  await distanceRange.evaluate((element, value) => {
    const input = element as HTMLInputElement
    input.value = String(value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }, distanceMeters)
}

async function enterDriveView(page: Page) {
  const headerEntry = page.getByTestId('drive-entry')
  if (await headerEntry.isVisible().catch(() => false)) {
    await headerEntry.click()
  } else {
    const driveFab = page.getByTestId('drive-fab')
    if (!(await driveFab.isVisible().catch(() => false))) {
      await selectStagePanel(page, /^map$/i)
    }
    await page.getByTestId('drive-fab').click()
  }
  await page.waitForFunction(
    () => document.querySelector<HTMLElement>('[data-testid="map-canvas"]')?.dataset.driveMode === 'true',
  )
  await page.waitForFunction(
    () => {
      const canvas = document.querySelector<HTMLElement>('[data-testid="map-canvas"]')
      if (!canvas) return false
      if (canvas.dataset.mapRenderer === 'maplibre') {
        return Boolean(document.querySelector<HTMLCanvasElement>('.maplibregl-canvas'))
      }

      return Boolean(document.querySelector<HTMLElement>('.leaflet-container'))
    },
    null,
    { timeout: 5_000 },
  )
}

async function ensureHeadingUp(page: Page) {
  const headingUp = await page.evaluate(() =>
    document.querySelector<HTMLElement>('[data-testid="map-canvas"]')?.classList.contains('is-heading-up') ?? false,
  )

  if (!headingUp) {
    await page.locator('button[title="Toggle map orientation"]:visible').click()
  }

  await page.waitForFunction(() =>
    document.querySelector<HTMLElement>('[data-testid="map-canvas"]')?.classList.contains('is-heading-up') ?? false,
  )
  await page.waitForTimeout(900)
}

async function waitForDriveTiles(page: Page) {
  await page.waitForFunction(
    () => {
      const canvas = document.querySelector<HTMLElement>('[data-testid="map-canvas"]')
      if (canvas?.dataset.mapRenderer === 'maplibre') {
        return (
          Number(canvas.dataset.mapZoom ?? 0) >= 18 &&
          canvas.dataset.mapLoaded === 'true' &&
          Boolean(document.querySelector<HTMLCanvasElement>('.maplibregl-canvas'))
        )
      }

      const mapZoom = Number(document.querySelector<HTMLElement>('.leaflet-container')?.dataset.zoom ?? 0)
      const tiles = Array.from(document.querySelectorAll<HTMLImageElement>('img.leaflet-tile'))
      return mapZoom >= 18 && tiles.some((tile) => tile.complete && tile.naturalWidth > 0)
    },
    null,
    { timeout: 12_000 },
  )
}

async function moveSimulationToFinish(page: Page, projectName: string) {
  if (projectName !== 'desktop') {
    await selectStagePanel(page, /shakedown/i)
  }

  const distanceRange = page.getByTestId('simulation-distance')
  await expect(distanceRange).toBeVisible()
  await distanceRange.evaluate((element) => {
    const input = element as HTMLInputElement
    input.value = input.max
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await page.waitForFunction(() => {
    const input = document.querySelector<HTMLInputElement>('[data-testid="simulation-distance"]')
    return input && Math.abs(Number(input.value) - Number(input.max)) < 1
  })
}

async function readDriveMetrics(page: Page) {
  return page.evaluate(() => {
    const map = document.querySelector('[data-testid="map-canvas"]')?.getBoundingClientRect()
    const car = document.querySelector('.rally-car-marker')?.getBoundingClientRect()
    const hudElement = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid="driver-hud"], [data-testid="driver-hud-mobile"]'),
    ).find((element) => {
      const box = element.getBoundingClientRect()
      return box.width > 0 && box.height > 0
    })
    const hud = hudElement?.getBoundingClientRect()

    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      carOffset:
        car && map
          ? {
              x: Math.round(car.left + car.width / 2 - (map.left + map.width / 2)),
              y: Math.round(car.top + car.height / 2 - (map.top + map.height / 2)),
            }
          : null,
      hud: hud
        ? {
            top: Math.round(hud.top),
            right: Math.round(hud.right),
            bottom: Math.round(hud.bottom),
            left: Math.round(hud.left),
            scrollHeight: Math.round(hudElement!.scrollHeight),
            clientHeight: Math.round(hudElement!.clientHeight),
          }
        : null,
    }
  })
}

test('setup panel shows app version', async ({ page }) => {
  await page.goto('/')
  await selectMainPanel(page, /^settings$/i)

  await expect(page.getByTestId('app-version')).toContainText(`v${packageJson.version}`)
})

test('compact app shell uses phone dock and tablet drawer without layout overflow', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'desktop', 'desktop uses the three-column workspace')
  const isTablet = testInfo.project.name === 'tablet'

  await page.goto('/')
  await expect(page.getByTestId('home-panel')).toBeVisible()

  if (isTablet) {
    await expect(page.getByTestId('mobile-editor-dock')).toHaveCount(0)
    await expect(page.getByTestId('mobile-menu-button')).toBeVisible()
  } else {
    await expect(page.getByTestId('mobile-editor-dock')).toBeVisible()
    await expect(page.getByTestId('mobile-menu-button')).toHaveCount(0)
  }

  const setupMetrics = await page.evaluate(() => {
    const rect = (selector: string) => {
      const box = document.querySelector(selector)?.getBoundingClientRect()
      return box
        ? {
            top: Math.round(box.top),
            right: Math.round(box.right),
            bottom: Math.round(box.bottom),
            left: Math.round(box.left),
            width: Math.round(box.width),
            height: Math.round(box.height),
          }
        : null
    }

    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      header: rect('header.navbar'),
      dock: rect('[data-testid="mobile-editor-dock"]'),
      drawer: rect('[data-testid="mobile-app-drawer"] aside'),
      drawerOpen: (() => {
        const box = document.querySelector('[data-testid="mobile-app-drawer"] aside')?.getBoundingClientRect()
        return box ? box.right > 1 && box.left < window.innerWidth - 1 : false
      })(),
      home: rect('[data-testid="home-panel"]'),
      setup: rect('[data-testid="setup-panel"]'),
      mapStage: rect('[data-testid="map-stage"]'),
      notes: rect('[data-testid="notes-panel"]'),
      headerText: document.querySelector('header.navbar')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      visibleHuds: Array.from(document.querySelectorAll<HTMLElement>('[data-testid="driver-hud"], [data-testid="driver-hud-mobile"]'))
        .filter((element) => {
          const box = element.getBoundingClientRect()
          return box.width > 0 && box.height > 0
        })
        .length,
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
    }
  })

  expect(setupMetrics.header?.height).toBeLessThanOrEqual(62)
  if (isTablet) {
    expect(setupMetrics.dock).toBeNull()
  } else {
    expect(setupMetrics.dock?.width).toBeGreaterThan(0)
  }
  expect(setupMetrics.home?.width).toBeGreaterThan(0)
  expect(setupMetrics.drawerOpen).toBe(false)
  expect(setupMetrics.headerText).not.toContain('Medvednica Recce')
  expect(setupMetrics.mapStage).toBeNull()
  expect(setupMetrics.notes).toBeNull()
  expect(setupMetrics.overflowX).toBeLessThanOrEqual(1)
  expect(setupMetrics.visibleHuds).toBe(0)

  if (isTablet) {
    await page.getByTestId('mobile-menu-button').click()
    await expect(page.locator('#app-navigation-drawer-panel')).toBeVisible()
    await page.getByTestId('mobile-app-drawer').getByRole('button', { name: /^stage$/i }).click()
  } else {
    await page.getByTestId('mobile-editor-dock').getByRole('button', { name: /^stage$/i }).click()
  }
  await expect(page.getByTestId('stage-workspace')).toBeVisible()
  await expect(page.getByTestId('setup-panel')).toBeVisible()

  await page.getByTestId('stage-subnav').getByRole('tab', { name: /^map$/i }).click()
  const preRouteMapMetrics = await page.evaluate(() => ({
    mapVisible: Boolean(document.querySelector('[data-testid="map-stage"]')?.getBoundingClientRect().width),
    setupVisible: Boolean(document.querySelector('[data-testid="setup-panel"]')?.getBoundingClientRect().width),
    stageTabWraps: Array.from(document.querySelectorAll<HTMLElement>('[data-testid="stage-subnav"] .tab span'))
      .filter((element) => {
        const box = element.getBoundingClientRect()
        return getComputedStyle(element).display !== 'none' && box.width > 0 && box.height > 0
      })
      .some((element) => element.getClientRects().length > 1 || element.scrollWidth > element.clientWidth + 1),
    overflowX: document.documentElement.scrollWidth - window.innerWidth,
  }))

  expect(preRouteMapMetrics.mapVisible).toBe(true)
  expect(preRouteMapMetrics.setupVisible).toBe(false)
  expect(preRouteMapMetrics.stageTabWraps).toBe(false)
  expect(preRouteMapMetrics.overflowX).toBeLessThanOrEqual(1)

  await page.getByTestId('stage-subnav').getByRole('tab', { name: /^route$/i }).click()

  await buildDemoRoute(page)

  const mapMetrics = await page.evaluate(() => ({
    mapVisible: Boolean(document.querySelector('[data-testid="map-stage"]')?.getBoundingClientRect().width),
    setupVisible: Boolean(document.querySelector('[data-testid="setup-panel"]')?.getBoundingClientRect().width),
    overflowX: document.documentElement.scrollWidth - window.innerWidth,
  }))

  expect(mapMetrics.mapVisible).toBe(true)
  expect(mapMetrics.setupVisible).toBe(false)
  expect(mapMetrics.overflowX).toBeLessThanOrEqual(1)

  await page.getByTestId('stage-subnav').getByRole('tab', { name: /co-driver/i }).click()
  const notesMetrics = await page.evaluate(() => ({
    notesVisible: Boolean(document.querySelector('[data-testid="notes-panel"]')?.getBoundingClientRect().width),
    mapVisible: Boolean(document.querySelector('[data-testid="map-stage"]')?.getBoundingClientRect().width),
    overflowX: document.documentElement.scrollWidth - window.innerWidth,
  }))

  expect(notesMetrics.notesVisible).toBe(true)
  expect(notesMetrics.mapVisible).toBe(false)
  expect(notesMetrics.overflowX).toBeLessThanOrEqual(1)
})

test('adaptive simulator drops target speed for upcoming corners', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'desktop keeps simulator controls visible while sampling')

  await buildDemoRoute(page)
  await setSimulationSpeed(page, 160)
  await setSimulationDistance(page, 80)
  await page.getByTestId('simulation-speed-mode-adaptive').click()
  await startSimulation(page)

  await page.waitForFunction(() => {
    const targetText = document.querySelector('[data-testid="simulation-target-speed"]')?.textContent ?? ''
    const target = Number(targetText.match(/\d+/)?.[0] ?? 999)
    return target < 145
  })

  const targetText = await page.getByTestId('simulation-target-speed').innerText()
  const speedText = await page.getByTestId('simulation-speed').innerText()
  const target = Number(targetText.match(/\d+/)?.[0] ?? 999)
  const speed = Number(speedText.match(/\d+/)?.[0] ?? 999)

  expect(target).toBeLessThan(145)
  expect(speed).toBeLessThan(160)
})

test('vehicle garage shows VIN-derived MINI visuals', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'rally-pacenotes.vehicle.v1',
      JSON.stringify({
        id: 'test-mini-f55',
        vin: 'WMWXT71DEMA000001',
        nickname: 'Garage car',
        make: 'MINI',
        model: 'Cooper SD',
        trim: '',
        modelYear: '2017',
        generation: 'Gen 3',
        chassis: 'F55',
        bodyStyle: '5-door hatch',
        engine: 'B47C20O0 2.0 diesel, 125 kW / 170 hp',
        fuelType: 'Diesel',
        driveType: 'Front-wheel drive',
        transmission: '',
        plant: 'OXFORD, UNITED KINGDOM, ENGLAND',
        imageUrl: '/vehicles/mini-f55-cooper-sd.svg',
        avatarUrl: '/vehicles/mini-f55-cooper-sd-avatar.svg',
        source: 'owner',
        decodeProvider: 'NHTSA vPIC',
        decodeConfidence: 'confirmed',
        decodeWarnings: [],
        obd: {
          adapterKind: 'ble',
          protocol: 'auto',
          vinPid: true,
          ecuNamePid: true,
          calibrationPid: true,
        },
        modifications: [],
      }),
    )
  })
  await page.goto('/')
  await selectMainPanel(page, /^garage$/i)

  await expect(page.getByTestId('vehicle-image')).toBeVisible()
  await expect(page.getByTestId('vehicle-image').locator('img')).toHaveAttribute(
    'src',
    /mini-f55-cooper-sd\.png/,
  )
  await expect(page.getByTestId('vehicle-avatar')).toHaveAttribute(
    'src',
    /mini-f55-cooper-sd-avatar\.png/,
  )
})

test('GPS flag starts live location tracking', async ({ page, context }) => {
  await context.grantPermissions(['geolocation'])
  await context.setGeolocation({
    latitude: 45.84264,
    longitude: 15.88717,
    accuracy: 7,
  })

  await buildDemoRoute(page)
  await enterDriveView(page)
  await page.getByTestId('recording-toggle').click()

  await expect(page.locator('button[title="Stop GPS drive"]')).toBeVisible()
  await expect(
    page.getByLabel('Driver state').locator('[title^="GPS tracking"], [title="GPS fix is stale"]'),
  ).toBeVisible()
})

test('drive speech does not restart active calls through clustered notes', async ({ page }) => {
  await page.route('**/api/voices', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ voices: [] }),
    })
  })
  await page.addInitScript(() => {
    type SpeechEvent = { action: 'speak' | 'cancel' | 'resume'; text?: string }
    type SpeechTestWindow = Window & {
      __speechEvents: SpeechEvent[]
      __speechUtterances: SpeechSynthesisUtterance[]
    }

    const testWindow = window as SpeechTestWindow
    testWindow.__speechEvents = []
    testWindow.__speechUtterances = []

    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        getVoices: () => [],
        addEventListener: () => {},
        removeEventListener: () => {},
        resume: () => testWindow.__speechEvents.push({ action: 'resume' }),
        cancel: () => testWindow.__speechEvents.push({ action: 'cancel' }),
        speak: (utterance: SpeechSynthesisUtterance) => {
          testWindow.__speechUtterances.push(utterance)
          testWindow.__speechEvents.push({ action: 'speak', text: utterance.text })
          window.setTimeout(() => utterance.onstart?.(new Event('start') as SpeechSynthesisEvent), 80)
        },
      },
    })
  })

  await buildDemoRoute(page)
  await setSimulationSpeed(page, 170)
  await startSimulation(page)
  await enterDriveView(page)
  await page.waitForFunction(() =>
    ((window as Window & {
      __speechEvents?: { action: 'speak' | 'cancel' | 'resume'; text?: string }[]
    }).__speechEvents ?? []).some((event) => event.action === 'speak'),
  )

  await page.waitForFunction(() => Number(document.querySelector('[data-testid="driver-hud"]')?.getAttribute('data-spoken-count') ?? 0) > 0)
  const firstSpokenId = await page.getByTestId('driver-hud').getAttribute('data-spoken-ids')
  const spokenSamples = []
  for (let index = 0; index < 4; index += 1) {
    await page.waitForTimeout(125)
    spokenSamples.push(await page.evaluate(() => ({
      spokenIds: document.querySelector('[data-testid="driver-hud"]')?.getAttribute('data-spoken-ids') ?? '',
      visibleSpeaking: document.querySelectorAll('.pace-call-icon__activity--speaking').length,
      visibleCompleted: document.querySelectorAll('.pace-call-icon__activity--completed').length,
      spokenCount: Number(document.querySelector('[data-testid="driver-hud"]')?.getAttribute('data-spoken-count') ?? 0),
    })))
  }
  expect(Math.max(...spokenSamples.map((sample) => sample.spokenCount))).toBeLessThanOrEqual(1)
  expect(Math.max(...spokenSamples.map((sample) => sample.visibleSpeaking))).toBeLessThanOrEqual(1)
  expect(spokenSamples.some((sample) => sample.spokenIds.length > 0)).toBe(true)

  await page.evaluate(() => {
    const testWindow = window as Window & { __speechUtterances?: SpeechSynthesisUtterance[] }
    testWindow.__speechUtterances?.forEach((utterance) => {
      utterance.onend?.(new Event('end') as SpeechSynthesisEvent)
    })
  })
  await page.waitForFunction(
    (completedId) => {
      const completedIds = document.querySelector('[data-testid="driver-hud"]')?.getAttribute('data-completed-ids') ?? ''
      return completedIds.split(',').includes(String(completedId))
    },
    firstSpokenId,
  )

  const events = await page.evaluate(() => (window as Window & {
    __speechEvents?: { action: 'speak' | 'cancel' | 'resume'; text?: string }[]
  }).__speechEvents ?? [])
  const speakEvents = events.filter((event) => event.action === 'speak')
  const cancelEvents = events.filter((event) => event.action === 'cancel')

  expect(speakEvents.length).toBeGreaterThan(0)
  expect(speakEvents.every((event) => !/\binto\s+into\b/i.test(event.text ?? ''))).toBe(true)
  expect(cancelEvents.length).toBeLessThanOrEqual(2)
})

test('drive mode keeps mobile screen awake until exit', async ({ page }) => {
  await page.addInitScript(() => {
    type WakeLockEvent = { action: 'request' | 'release'; type: string }
    type WakeLockTestWindow = Window & { __wakeLockEvents: WakeLockEvent[] }
    type TestWakeLockSentinel = EventTarget & {
      released: boolean
      type: string
      release: () => Promise<void>
    }

    const testWindow = window as WakeLockTestWindow
    testWindow.__wakeLockEvents = []

    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: {
        request: async (type: string) => {
          const sentinel = new EventTarget() as TestWakeLockSentinel
          sentinel.released = false
          sentinel.type = type
          sentinel.release = async () => {
            if (sentinel.released) return
            sentinel.released = true
            testWindow.__wakeLockEvents.push({ action: 'release', type })
            sentinel.dispatchEvent(new Event('release'))
          }
          testWindow.__wakeLockEvents.push({ action: 'request', type })
          return sentinel
        },
      },
    })
  })

  await buildDemoRoute(page)
  await enterDriveView(page)

  await page.waitForFunction(() =>
    ((window as Window & { __wakeLockEvents?: { action: string; type: string }[] }).__wakeLockEvents ?? [])
      .some((event) => event.action === 'request' && event.type === 'screen'),
  )
  await expect(page.getByTestId('app-shell')).toHaveAttribute('data-screen-wake-lock-status', 'active')
  await expect(page.getByTestId('app-shell')).toHaveAttribute('data-screen-wake-lock-active', 'true')

  await page.locator('button[title="Toggle drive view"]').click()

  await page.waitForFunction(() =>
    ((window as Window & { __wakeLockEvents?: { action: string; type: string }[] }).__wakeLockEvents ?? [])
      .some((event) => event.action === 'release' && event.type === 'screen'),
  )
  await expect(page.getByTestId('app-shell')).toHaveAttribute('data-screen-wake-lock-status', 'idle')
  await expect(page.getByTestId('app-shell')).toHaveAttribute('data-screen-wake-lock-active', 'false')
})

test('OBD mock stream populates reliable telemetry fields', async ({ page }) => {
  await page.goto('/')
  await selectMainPanel(page, /^garage$/i)
  await page.getByRole('button', { name: /mock/i }).click()

  await expect(page.getByTestId('obd-status')).toHaveText(/mock/i)
  await expect(page.getByTestId('obd-rpm')).not.toHaveText('--')
  await expect(page.getByTestId('obd-throttle')).not.toHaveText('--')
  await expect(page.getByTestId('obd-speed')).not.toHaveText('--')
  await expect(page.getByTestId('obd-voltage')).toHaveText(/V/)
})

test('drive mode keeps the car centered and starts at road-scale zoom', async ({ page }, testInfo) => {
  await buildDemoRoute(page)
  await startSimulation(page)
  await enterDriveView(page)
  await page.waitForTimeout(450)
  await waitForDriveTiles(page)

  const driveMetrics = await readDriveMetrics(page)
  const routeMetrics = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLElement>('[data-testid="map-canvas"]')
    if (canvas?.dataset.mapRenderer === 'maplibre') {
      return {
        maxTileZoom: Number(canvas.dataset.mapZoom ?? 0),
        mapZoom: Number(canvas.dataset.mapZoom ?? 0),
        overflowX: document.documentElement.scrollWidth - window.innerWidth,
      }
    }

    const tileZooms = Array.from(document.querySelectorAll<HTMLImageElement>('.leaflet-tile'))
      .map((tile) => tile.src.match(/tile\.openstreetmap\.org\/(\d+)\//)?.[1])
      .filter(Boolean)
      .map(Number)
    const mapZoom = Number((document.querySelector('.leaflet-container') as HTMLElement | null)?.dataset.zoom ?? 0)

    return {
      maxTileZoom: tileZooms.length ? Math.max(...tileZooms) : 0,
      mapZoom,
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
    }
  })
  const metrics = { ...driveMetrics, ...routeMetrics }
  const horizontalTolerance = testInfo.project.name === 'desktop' ? 2 : metrics.viewport.width * 0.04

  expect(metrics.carOffset).not.toBeNull()
  expect(Math.abs(metrics.carOffset!.x)).toBeLessThanOrEqual(horizontalTolerance)
  expect(metrics.carOffset!.y).toBeGreaterThan(20)
  expect(metrics.carOffset!.y).toBeLessThanOrEqual(metrics.viewport.height * 0.18)
  expect(Math.max(metrics.maxTileZoom, metrics.mapZoom)).toBeGreaterThanOrEqual(18)
  expect(metrics.overflowX).toBeLessThanOrEqual(1)
  expect(metrics.hud).not.toBeNull()
  expect(metrics.hud!.left).toBeGreaterThanOrEqual(0)
  expect(metrics.hud!.right).toBeLessThanOrEqual(metrics.viewport.width + 1)
  expect(metrics.hud!.bottom).toBeLessThanOrEqual(metrics.viewport.height + 1)

  if (testInfo.project.name !== 'desktop') {
    expect(metrics.hud!.scrollHeight).toBeLessThanOrEqual(metrics.hud!.clientHeight + 2)
  }
})

test('drive map renders ten segment gates with crossed state', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'gate source wiring only needs one viewport')

  await buildDemoRoute(page)
  await selectStagePanel(page, /shakedown/i)
  const targetDistance = await page
    .getByTestId('simulation-distance')
    .locator('[role="slider"]')
    .evaluate((element) => Number(element.getAttribute('aria-valuemax')) * 0.36)
  await setSimulationDistance(page, targetDistance)
  await enterDriveView(page)

  await page.waitForFunction(() => {
    const canvas = document.querySelector<HTMLElement>('[data-testid="map-canvas"]')
    return (
      Number(canvas?.dataset.gateLineCount ?? 0) === 10 &&
      Number(canvas?.dataset.gateFeatureCount ?? 0) === 30 &&
      Number(canvas?.dataset.gatePassedCount ?? 0) >= 3
    )
  })

  const metrics = await page.getByTestId('map-canvas').evaluate((canvas) => ({
    featureCount: Number(canvas.dataset.gateFeatureCount ?? 0),
    lineCount: Number(canvas.dataset.gateLineCount ?? 0),
    passedCount: Number(canvas.dataset.gatePassedCount ?? 0),
    goodCount: Number(canvas.dataset.gateGoodCount ?? 0),
    lateCount: Number(canvas.dataset.gateLateCount ?? 0),
  }))

  expect(metrics.featureCount).toBe(30)
  expect(metrics.lineCount).toBe(10)
  expect(metrics.passedCount).toBeGreaterThanOrEqual(3)
  expect(metrics.goodCount).toBe(metrics.passedCount)
  expect(metrics.lateCount).toBe(0)
})

test('phone drive mode renders road-scale map tiles while following the car', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'desktop', 'phone tile loading is the target path')

  await buildDemoRoute(page)
  await setSimulationSpeed(page, 170)
  await startSimulation(page)
  await enterDriveView(page)
  await waitForDriveTiles(page)

  const metrics = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLElement>('[data-testid="map-canvas"]')
    if (canvas?.dataset.mapRenderer === 'maplibre') {
      return {
        renderer: 'maplibre',
        mapZoom: Number(canvas.dataset.mapZoom ?? 0),
        tileCount: Number(Boolean(document.querySelector('.maplibregl-canvas'))),
        loadedTiles: canvas.dataset.mapLoaded === 'true' ? 1 : 0,
        maxTileZoom: Number(canvas.dataset.mapZoom ?? 0),
        noteMarkers: Number(canvas.dataset.noteCount ?? 0),
        routePaths: Number(canvas.dataset.routeFeatureCount ?? 0),
        routePathLength: Number(canvas.dataset.routeFeatureCount ?? 0),
      }
    }

    const tiles = Array.from(document.querySelectorAll<HTMLImageElement>('img.leaflet-tile'))
    const mapZoom = Number(document.querySelector<HTMLElement>('.leaflet-container')?.dataset.zoom ?? 0)
    const tileZooms = tiles
      .map((tile) => tile.src.match(/tile\.openstreetmap\.org\/(\d+)\//)?.[1])
      .filter(Boolean)
      .map(Number)

    return {
      renderer: 'leaflet',
      mapZoom,
      tileCount: tiles.length,
      loadedTiles: tiles.filter((tile) => tile.complete && tile.naturalWidth > 0).length,
      maxTileZoom: tileZooms.length ? Math.max(...tileZooms) : 0,
      noteMarkers: document.querySelectorAll('.pace-map-marker').length,
      routePaths: document.querySelectorAll('.leaflet-overlay-pane path').length,
      routePathLength: document.querySelector('.rally-route-main')?.getAttribute('d')?.length ?? 0,
    }
  })

  expect(metrics.mapZoom).toBeGreaterThanOrEqual(18)
  expect(metrics.tileCount).toBeGreaterThan(0)
  expect(metrics.loadedTiles).toBeGreaterThan(0)
  expect(metrics.maxTileZoom).toBeGreaterThanOrEqual(18)
  expect(metrics.noteMarkers).toBeGreaterThan(0)
  expect(metrics.noteMarkers).toBeLessThanOrEqual(10)
  if (metrics.renderer === 'maplibre') {
    expect(metrics.routePaths).toBeGreaterThan(0)
  } else {
    expect(metrics.routePaths).toBe(3)
    expect(metrics.routePathLength).toBeLessThan(1_200)
  }
})

test('drive bottom badges use stable fixed readouts with progress rail', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'desktop', 'phone badge rendering is the target path')

  await buildDemoRoute(page)
  await setSimulationSpeed(page, 170)
  await startSimulation(page)
  await enterDriveView(page)

  const samples = []
  for (let index = 0; index < 120; index += 1) {
    await page.waitForTimeout(25)
    samples.push(await page.evaluate(() => {
      const read = (selector: string) => {
        const element = document.querySelector<HTMLElement>(selector)
        const box = element?.getBoundingClientRect()
        return box
          ? {
              width: Number(box.width.toFixed(3)),
              height: Number(box.height.toFixed(3)),
              countdowns: element.querySelectorAll('.countdown').length,
              text: element.textContent?.replace(/\s+/g, ' ').trim() ?? '',
            }
          : null
      }

      return {
        elapsed: read('[data-testid="drive-elapsed-badge"]'),
        ghost: read('[data-testid="drive-ghost-badge"]'),
        distanceCount: document.querySelectorAll('[data-testid="drive-distance-badge"]').length,
        progressRail: read('[data-testid="drive-progress-rail"]'),
      }
    }))
  }

  expect(samples.every((sample) => sample.distanceCount === 0)).toBe(true)
  expect(samples.some((sample) => sample.progressRail !== null)).toBe(true)

  for (const key of ['elapsed', 'ghost'] as const) {
    const values = samples.map((sample) => sample[key]).filter(Boolean)
    const widths = values.map((value) => value!.width)
    const heights = values.map((value) => value!.height)

    expect(values.length).toBeGreaterThan(0)
    expect(values[0]!.countdowns).toBe(0)
    expect(values[0]!.text.length).toBeGreaterThan(0)
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1)
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(1)
  }

  const progressMetrics = await page.getByTestId('drive-progress-rail').evaluate((rail) => {
    const box = rail.getBoundingClientRect()
    const sections = Array.from(rail.querySelectorAll<HTMLElement>('.wrc-stage-progress__section'))
    const activeSections = sections.filter((section) => section.classList.contains('is-active'))
    const currentSections = sections.filter((section) => section.classList.contains('is-current'))
    const driverMarker = rail.querySelector<HTMLElement>('.wrc-stage-progress__marker--driver')?.getBoundingClientRect()
    const ghostMarker = rail.querySelector<HTMLElement>('.wrc-stage-progress__marker--ghost')?.getBoundingClientRect()

    return {
      width: Math.round(box.width),
      height: Math.round(box.height),
      sectionCount: sections.length,
      activeCount: activeSections.length,
      currentCount: currentSections.length,
      driverInside: driverMarker
        ? driverMarker.left >= box.left - 2 &&
          driverMarker.right <= box.right + 2 &&
          driverMarker.top >= box.top - 10 &&
          driverMarker.bottom <= box.bottom + 10
        : false,
      ghostInside: ghostMarker
        ? ghostMarker.left >= box.left - 2 &&
          ghostMarker.right <= box.right + 2 &&
          ghostMarker.top >= box.top - 10 &&
          ghostMarker.bottom <= box.bottom + 10
        : false,
    }
  })

  expect(progressMetrics.width).toBeGreaterThan(320)
  expect(progressMetrics.height).toBeGreaterThan(16)
  expect(progressMetrics.height).toBeLessThan(36)
  expect(progressMetrics.sectionCount).toBe(10)
  expect(progressMetrics.activeCount).toBeGreaterThanOrEqual(0)
  expect(progressMetrics.currentCount).toBe(1)
  expect(progressMetrics.driverInside).toBe(true)
  expect(progressMetrics.ghostInside).toBe(true)
})

test('active timeline call uses a color-matched outer glow', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'desktop', 'phone timeline emphasis is the target path')

  await buildDemoRoute(page)
  await startSimulation(page)
  await enterDriveView(page)
  await page.waitForTimeout(450)

  const activeStyle = await page.locator('.wrc-timeline-node.is-active .pace-call-icon').first().evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      boxShadow: style.boxShadow,
      filter: style.filter,
    }
  })

  expect(activeStyle.boxShadow).toMatch(/oklab|color\(srgb|rgb/)
  expect(activeStyle.boxShadow.split('px,').length).toBeGreaterThanOrEqual(4)
  expect(activeStyle.filter).toContain('brightness')

  const stripSpacing = await page.locator('[data-testid="call-strip"]').evaluate((strip) => {
    const viewportBox = strip.parentElement?.getBoundingClientRect()
    const stripBox = strip.getBoundingClientRect()
    const viewportClipPath = strip.parentElement ? getComputedStyle(strip.parentElement).clipPath : 'none'
    const nodes = Array.from(strip.querySelectorAll<HTMLElement>('.wrc-timeline-node'))
    const firstBox = nodes[0]?.getBoundingClientRect()
    const lastBox = nodes[nodes.length - 1]?.getBoundingClientRect()
    const nodeBoxes = nodes.map((node) => node.getBoundingClientRect())
    const gaps = nodeBoxes.slice(1).map((box, index) => box.left - nodeBoxes[index].right)

    return {
      leftGap: firstBox ? firstBox.left - stripBox.left : 0,
      rightGap: lastBox ? stripBox.right - lastBox.right : 0,
      maxNodeGap: gaps.length ? Math.max(...gaps) : 0,
      minNodeGap: gaps.length ? Math.min(...gaps) : 0,
      centerDelta: viewportBox ? Math.abs(
        (stripBox.left + stripBox.width / 2) - (viewportBox.left + viewportBox.width / 2),
      ) : 0,
      viewportClipPath,
    }
  })

  expect(stripSpacing.rightGap).toBeLessThanOrEqual(stripSpacing.leftGap + 16)
  expect(stripSpacing.maxNodeGap - stripSpacing.minNodeGap).toBeLessThanOrEqual(2)
  expect(stripSpacing.centerDelta).toBeLessThanOrEqual(1)
  expect(stripSpacing.viewportClipPath).not.toBe('none')

  const boardLayout = await page.evaluate(() => {
    const board = document.querySelector<HTMLElement>('.wrc-call-board')?.getBoundingClientRect()
    const text = document.querySelector<HTMLElement>('.wrc-current-call__text')?.getBoundingClientRect()
    const strip = document.querySelector<HTMLElement>('[data-testid="call-strip"]')?.getBoundingClientRect()
    const state = document.querySelector<HTMLElement>('[data-testid="driver-state-strip"]')?.getBoundingClientRect()

    return board && text && strip && state
      ? {
          textRightRoom: board.right - text.right,
          stateBelowStrip: state.top - strip.bottom,
          stateCenterDelta: Math.abs(
            (state.left + state.width / 2) - (board.left + board.width / 2),
          ),
        }
      : null
  })

  expect(boardLayout).not.toBeNull()
  expect(boardLayout!.textRightRoom).toBeGreaterThanOrEqual(0)
  expect(boardLayout!.stateBelowStrip).toBeGreaterThanOrEqual(-1)
  expect(boardLayout!.stateCenterDelta).toBeLessThanOrEqual(1)
})

test('heading-up drive view keeps the car mostly centered on phones', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'desktop', 'phone heading-up framing is the risky layout')

  await buildDemoRoute(page)
  await startSimulation(page)
  await enterDriveView(page)
  await ensureHeadingUp(page)

  const driveMetrics = await readDriveMetrics(page)
  const modeMetrics = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLElement>('[data-testid="map-canvas"]')
    if (canvas?.dataset.mapRenderer === 'maplibre') {
      return {
        headingUp: Math.abs(Number(canvas.dataset.mapBearing ?? 0)) > 0.1,
        renderer: 'maplibre',
        transformedPanes: 0,
        transitionedPanes: 0,
        routeFeatures: Number(canvas.dataset.routeFeatureCount ?? 0),
      }
    }

    return {
      headingUp: document.querySelector('.leaflet-container')?.classList.contains('map-heading-up') ?? false,
      renderer: 'leaflet',
      transformedPanes: Array.from(document.querySelectorAll<HTMLElement>('.leaflet-pane'))
        .filter((pane) => pane.style.transform.includes('rotate')).length,
      transitionedPanes: Array.from(document.querySelectorAll<HTMLElement>('.leaflet-pane'))
        .filter((pane) => getComputedStyle(pane).transitionProperty.includes('transform')).length,
      routeFeatures: 0,
    }
  })
  const metrics = { ...driveMetrics, ...modeMetrics }

  expect(metrics.headingUp).toBe(true)
  if (metrics.renderer === 'maplibre') {
    expect(metrics.transformedPanes).toBe(0)
    expect(metrics.routeFeatures).toBeGreaterThan(0)
  } else {
    expect(metrics.transformedPanes).toBeLessThanOrEqual(4)
    expect(metrics.transitionedPanes).toBeGreaterThanOrEqual(metrics.transformedPanes)
  }
  expect(metrics.carOffset).not.toBeNull()
  expect(Math.abs(metrics.carOffset!.x)).toBeLessThanOrEqual(metrics.viewport.width * 0.08)
  expect(metrics.carOffset!.y).toBeGreaterThan(20)
  expect(metrics.carOffset!.y).toBeLessThanOrEqual(metrics.viewport.height * 0.18)
})

test('heading-up drive view uses the MapLibre drive renderer', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'desktop', 'phone drive renderer coverage')

  await buildDemoRoute(page)
  await startSimulation(page)
  await enterDriveView(page)
  await ensureHeadingUp(page)

  const metrics = await page.evaluate(() => {
    const frame = document.querySelector('[data-testid="map-canvas"]')?.getBoundingClientRect()
    const surface = document.querySelector('[data-testid="maplibre-surface"]')?.getBoundingClientRect()
    const canvas = document.querySelector<HTMLElement>('[data-testid="map-canvas"]')
    const glCanvas = document.querySelector<HTMLCanvasElement>('.maplibregl-canvas')?.getBoundingClientRect()

    return frame && surface && glCanvas && canvas
      ? {
          renderer: canvas.dataset.mapRenderer,
          bearing: Number(canvas.dataset.mapBearing ?? 0),
          frameWidth: Math.round(frame.width),
          frameHeight: Math.round(frame.height),
          surfaceWidth: Math.round(surface.width),
          surfaceHeight: Math.round(surface.height),
          canvasWidth: Math.round(glCanvas.width),
          canvasHeight: Math.round(glCanvas.height),
        }
      : null
  })

  expect(metrics).not.toBeNull()
  expect(metrics!.renderer).toBe('maplibre')
  expect(Math.abs(metrics!.bearing)).toBeGreaterThan(0.1)
  expect(metrics!.surfaceWidth).toBe(metrics!.frameWidth)
  expect(metrics!.surfaceHeight).toBe(metrics!.frameHeight)
  expect(metrics!.canvasWidth).toBeGreaterThan(0)
  expect(metrics!.canvasHeight).toBeGreaterThan(0)
})

test('finish call terminates the HUD note strip', async ({ page }, testInfo) => {
  await buildDemoRoute(page)
  await moveSimulationToFinish(page, testInfo.project.name)
  await enterDriveView(page)

  const callKinds = await page
    .locator('[data-testid="call-strip"] [data-note-kind]')
    .evaluateAll((items) => items.map((item) => item.getAttribute('data-note-kind')))
  const currentCall = await page.locator('.wrc-current-call__text').innerText()

  expect(currentCall.toLowerCase()).toContain('finish')
  expect(callKinds).toEqual(['finish'])
})

test('pace icons render filled arrow tips at visible sizes', async ({ page }, testInfo) => {
  await buildDemoRoute(page)
  if (testInfo.project.name !== 'desktop') {
    await selectStagePanel(page, /co-driver/i)
  }

  const icons = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('.pace-call-icon'))
      .filter((icon) => {
        const box = icon.getBoundingClientRect()
        return box.width > 0 && box.height > 0
      })
      .map((icon) => {
        const bodyPath = icon.querySelector<SVGGraphicsElement>('svg g path:not(.pace-call-icon__arrow-tip)')
        const tipPath = icon.querySelector<SVGGraphicsElement>('.pace-call-icon__arrow-tip')
        const body = bodyPath?.getBBox()
        const tip = tipPath?.getBBox()

        return body && tip
          ? {
              iconWidth: Math.round(icon.getBoundingClientRect().width),
              icon: {
                top: Math.round(icon.getBoundingClientRect().top),
                right: Math.round(icon.getBoundingClientRect().right),
                bottom: Math.round(icon.getBoundingClientRect().bottom),
                left: Math.round(icon.getBoundingClientRect().left),
              },
              tip: {
                top: Math.round(tipPath.getBoundingClientRect().top),
                right: Math.round(tipPath.getBoundingClientRect().right),
                bottom: Math.round(tipPath.getBoundingClientRect().bottom),
                left: Math.round(tipPath.getBoundingClientRect().left),
              },
              bodyWidth: Math.round(body.width),
              bodyHeight: Math.round(body.height),
              tipWidth: Math.round(tip.width),
              tipHeight: Math.round(tip.height),
            }
          : null
      })
      .filter(Boolean)
      .slice(0, 8),
  )

  expect(icons.length).toBeGreaterThan(0)
  for (const icon of icons) {
    expect(icon!.iconWidth).toBeGreaterThan(30)
    expect(Math.max(icon!.bodyWidth, icon!.bodyHeight)).toBeGreaterThan(4)
    expect(icon!.tipWidth).toBeGreaterThan(12)
    expect(icon!.tipHeight).toBeGreaterThan(12)
    expect(icon!.tip.top).toBeGreaterThanOrEqual(icon!.icon.top - 1)
    expect(icon!.tip.right).toBeLessThanOrEqual(icon!.icon.right + 1)
    expect(icon!.tip.bottom).toBeLessThanOrEqual(icon!.icon.bottom + 1)
    expect(icon!.tip.left).toBeGreaterThanOrEqual(icon!.icon.left - 1)
  }
})
