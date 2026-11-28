/**
 * Las páginas de lista en un teléfono.
 *
 * Perfil, Biblioteca y Ajustes comparten contenedor, y el criterio de estas
 * pruebas es el mismo en las tres: que la página no desplace a lo ancho y que sus
 * mandos principales estén a la vista y se puedan pulsar. La biblioteca con
 * descargas y su reproductor van por rutas interceptadas: el arnés del e2e no
 * descarga nada de verdad y lo que se mide aquí es la pantalla, no el motor.
 */

import { expect, type Locator, type Page, test } from '@playwright/test'
import { entrar, esperarApp } from './fixtures'

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

/** El ancho que sobra a la página: cero o negativo significa que no hay desborde. */
async function desborde(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
}

/** La opacidad que el navegador pinta, que es lo que dice si la banda está. */
async function opacidadDe(nodo: Locator): Promise<number> {
  return nodo.evaluate((elemento) => Number(getComputedStyle(elemento).opacity))
}

/** Una descarga completa, con lo que la pantalla necesita para pintarla. */
function descarga(id: number, episodio: string, bytes = 1024 * 1024) {
  return {
    id,
    providerId: 'fixture',
    animeRef: { providerId: 'fixture', value: 'aurora-nocturna' },
    episodeRef: { providerId: 'fixture', value: `aurora-nocturna#${id}` },
    title: 'Aurora Nocturna',
    episodeLabel: episodio,
    mode: 'sub',
    kind: 'file',
    status: 'complete',
    bytes,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

async function interceptarDescargas(page: Page, items: readonly unknown[]): Promise<void> {
  await page.route('**/api/downloads', async (ruta) => {
    await ruta.fulfill({ json: { items } })
  })
  await page.route('**/api/downloads/space', async (ruta) => {
    await ruta.fulfill({
      json: {
        freeBytes: 700 * 1024 ** 3,
        totalBytes: 930 * 1024 ** 3,
        downloadsBytes: 2 * 1024 ** 3,
        path: 'C:\\Users\\nn\\Descargas',
      },
    })
  })
}

test.describe('la biblioteca en el móvil', () => {
  test('el vacío se explica, la carpeta se abre y nada desborda', async ({ page }) => {
    await entrar(page)
    await page.locator('.barra').getByRole('link', { name: 'Biblioteca' }).click()

    await expect(page.getByRole('heading', { level: 1, name: 'Biblioteca' })).toBeVisible()
    await expect(page.getByText('Tu biblioteca está vacía.')).toBeVisible()

    await page.getByText('Carpeta y espacio').click()
    await expect(page.getByLabel('Se guardan en')).toHaveValue(/.+/)
    await expect(page.getByRole('button', { name: 'Elegir carpeta…' })).toBeVisible()

    expect(await desborde(page)).toBeLessThanOrEqual(0)
  })
})

test.describe('el reproductor de una descarga en el móvil', () => {
  test('los mandos están y la página no desborda', async ({ page }) => {
    await interceptarDescargas(page, [descarga(42, 'Episodio 1'), descarga(43, 'Episodio 2')])
    await page.route('**/api/downloads/42', async (ruta) => {
      await ruta.fulfill({ json: descarga(42, 'Episodio 1') })
    })

    await entrar(page)
    await page.goto('/library/42')

    await expect(page.getByRole('heading', { level: 1, name: 'Aurora Nocturna' })).toBeVisible()
    await expect(page.locator('.library-player__badge')).toBeVisible()
    await expect(page.locator('.library-player__back')).toBeVisible()

    // El reporte también vive en esta pantalla, que no lleva pie.
    const reporte = page.getByRole('button', { name: 'Reportar un problema' })
    await expect(reporte).toBeVisible()
    await reporte.click()
    await expect(page.getByRole('dialog', { name: 'Reportar un problema' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Reportar un problema' })).toBeHidden()

    // A 390 px y con el dedo, el reproductor es el del teléfono: no hay saltos de
    // diez segundos, ni volumen, ni modo extendido. Lo que tiene que estar a la
    // vista es lo de siempre: play, ajustes y pantalla completa.
    for (const mando of ['Reproducir', 'Ajustes', 'Pantalla completa']) {
      await expect(page.getByRole('button', { name: mando })).toBeVisible()
    }

    // El volumen lo gobierna el aparato y el modo extendido lo pone el giro: en el
    // documento no hay ninguno de los dos, ni en la fila ni en el menú.
    await expect(page.getByRole('button', { name: 'Silenciar' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Modo extendido' })).toHaveCount(0)

    await page.getByRole('button', { name: 'Ajustes' }).click()
    const menu = page.locator('.player__menu')
    await expect(menu).toBeVisible()
    await expect(menu.getByRole('button', { name: 'Silenciar' })).toHaveCount(0)
    await expect(menu.getByRole('button', { name: 'Modo compatible' })).toHaveCount(0)
    await expect(menu.getByRole('button', { name: 'Atajos de teclado' })).toHaveCount(0)
    await expect(menu.getByRole('button', { name: 'Ver en mpv' })).toHaveCount(0)
    // La velocidad sí: es lo que se ajusta desde el teléfono.
    await expect(menu.getByRole('button', { name: '1×' })).toBeVisible()

    // Y el mando mide los 44 px del objetivo táctil: en vertical el teléfono
    // recupera el tamaño completo, que el volumen y el modo extendido ya no
    // ocupan su hueco.
    const anchoDelMando = await page.evaluate(() => {
      const mando = document.querySelector(
        '.player__buttons .player__control:not(.button--primary)',
      )

      return mando?.getBoundingClientRect().width ?? 0
    })
    expect(anchoDelMando).toBeGreaterThanOrEqual(44)

    // Las flechas de episodio y la lista, debajo del reproductor.
    await expect(page.getByRole('link', { name: /Siguiente: Episodio 2/ })).toBeVisible()
    await expect(page.locator('.watch__list-item', { hasText: 'Episodio 2' })).toBeVisible()

    expect(await desborde(page)).toBeLessThanOrEqual(0)
  })

  test('borrar un episodio pide confirmación', async ({ page }) => {
    await interceptarDescargas(page, [descarga(42, 'Episodio 1')])
    await entrar(page)
    await page.goto('/library')

    await page.getByRole('button', { name: 'Borrar Episodio 1' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByRole('heading', { name: '¿Eliminar la descarga?' })).toBeVisible()

    await page.getByRole('button', { name: 'Cancelar' }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
  })
})

/**
 * El reproductor del teléfono.
 *
 * Mide lo que no se ve en el render de servidor: que el `pointer: coarse` de
 * verdad quite los mandos de escritorio, que girar ponga el video a pantalla
 * completa sin pedirle permiso al navegador y que la banda se retire sola aunque
 * el foco se quede en el botón que se acaba de tocar.
 */
test.describe('el reproductor en un teléfono', () => {
  const DIRECCION = '/watch/fixture/aurora-nocturna%239?anime=aurora-nocturna&at=30'

  test('en táctil sobran los mandos de escritorio y el reinicio', async ({ page }) => {
    await entrar(page)
    await page.goto(DIRECCION)

    await expect(page.locator('.player__seek .player__range')).toBeEnabled({ timeout: 15_000 })
    await expect(page.locator('.watch__resume')).toContainText('Continúa en 0:30')

    // La información de dónde continúa se queda; el mando para empezar de cero se
    // va: para eso está la barra, que se arrastra con el dedo.
    await expect(page.getByRole('button', { name: 'Empezar de cero' })).toHaveCount(0)

    for (const mando of ['Silenciar', 'Modo extendido']) {
      await expect(page.getByRole('button', { name: mando })).toHaveCount(0)
    }

    await page.getByRole('button', { name: 'Ajustes' }).click()
    const menu = page.locator('.player__menu')
    await expect(menu).toBeVisible()

    for (const mando of ['Modo compatible', 'Atajos de teclado', 'Ver en mpv', 'Silenciar']) {
      await expect(menu.getByRole('button', { name: mando })).toHaveCount(0)
    }
  })

  /**
   * El giro pone la pantalla completa.
   *
   * `requestFullscreen` exige un gesto y girar el aparato no lo es, así que el
   * horizontal lo resuelve el modo extendido —el mismo `position: fixed` de
   * siempre—, que no depende de ninguna API. Y el mando recupera los 44 px que el
   * teléfono le había quitado para que cupiera el volumen.
   */
  test('al girar a horizontal ocupa la pantalla y los mandos miden 44', async ({ page }) => {
    await entrar(page)
    await page.goto(DIRECCION)
    await expect(page.locator('.player__seek .player__range')).toBeEnabled({ timeout: 15_000 })

    const reproductor = page.locator('.player')
    await expect(reproductor).toHaveAttribute('data-extendido', 'false')

    await page.setViewportSize({ width: 844, height: 390 })
    await expect(reproductor).toHaveAttribute('data-extendido', 'true')

    const caja = await reproductor.boundingBox()
    expect(caja?.width).toBeGreaterThanOrEqual(843)
    expect(caja?.height).toBeGreaterThanOrEqual(389)

    const medidas = await page.evaluate(() => {
      const mando = document.querySelector(
        '.player__buttons .player__control:not(.button--primary)',
      )
      const carril = document.querySelector('.player__seek .player__range')

      return {
        mando: mando?.getBoundingClientRect().width ?? 0,
        carril: carril?.getBoundingClientRect().height ?? 0,
      }
    })
    expect(medidas.mando).toBeGreaterThanOrEqual(44)
    expect(medidas.carril).toBeGreaterThanOrEqual(32)

    // Volver a vertical devuelve la pantalla normal.
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(reproductor).toHaveAttribute('data-extendido', 'false')
  })

  /**
   * La barra se retira y el menú no.
   *
   * El fallo era el foco: en táctil, el botón que se acaba de tocar conserva el
   * foco y `:focus-within` mantenía la banda encima del fotograma para siempre. Con
   * `:focus-visible` la cuenta atrás manda, salvo que haya un menú abierto —esa es
   * la excepción que sigue sujeta a mano—.
   */
  test('la banda se retira a los dos segundos y el menú abierto la sujeta', async ({ page }) => {
    await entrar(page)
    await page.goto(DIRECCION)
    await expect(page.locator('.player__seek .player__range')).toBeEnabled({ timeout: 15_000 })
    await page.setViewportSize({ width: 844, height: 390 })

    const controles = page.locator('.player__controls')
    await page.getByRole('button', { name: 'Reproducir' }).tap()
    await expect(page.getByRole('button', { name: 'Pausar' })).toBeVisible()
    await expect
      .poll(async () => await opacidadDe(controles), { timeout: 5_000 })
      .toBeLessThan(0.05)

    // Una pulsación sobre el video la devuelve; con el video en marcha, abrir los
    // ajustes la sujeta aunque la cuenta atrás venza.
    await page.locator('.player__frame').tap()
    await page.getByRole('button', { name: 'Reproducir' }).tap()
    await page.getByRole('button', { name: 'Ajustes' }).tap()
    await expect(page.locator('.player__menu')).toBeVisible()
    await page.waitForTimeout(2_600)
    expect(await opacidadDe(controles)).toBe(1)
    await expect(page.locator('.player__menu')).toBeVisible()
  })
})

test.describe('el perfil en el móvil', () => {
  test('las cuatro secciones, con su eje y sin desbordes', async ({ page }) => {
    await entrar(page)
    await page.goto('/profile')
    await esperarApp(page)

    await expect(page.getByRole('heading', { level: 1, name: 'Perfil' })).toBeVisible()

    for (const seccion of ['Favoritos', 'Ya vistos', 'Quiero ver', 'Historial']) {
      await expect(page.getByRole('heading', { level: 2, name: seccion })).toBeVisible()
    }

    // Las cuatro listas, cada una con tarjetas o con su tarjeta de vacío: la
    // pasada del e2e comparte base y no se puede exigir que estén vacías. El
    // Perfil lleva además la puerta a la encuesta de gustos, así que no se fija
    // el total de secciones: las cuatro de siempre tienen que estar.
    expect(await page.locator('.perfil .pagina__seccion').count()).toBeGreaterThanOrEqual(4)
    await expect(
      page.locator('.perfil .pagina__seccion .pz, .perfil .estado-vacio').first(),
    ).toBeVisible()

    // El Perfil comparte el margen de las otras páginas: su título y sus
    // secciones empiezan en el mismo eje.
    const eje = await page.evaluate(() => {
      const titulo = document.querySelector('.perfil > h1')?.getBoundingClientRect().left ?? -1
      const seccion =
        document.querySelector('.perfil .pagina__titulo')?.getBoundingClientRect().left ?? -2

      return { titulo, seccion }
    })
    expect(eje.seccion).toBe(eje.titulo)

    expect(await desborde(page)).toBeLessThanOrEqual(0)
  })
})

test.describe('los ajustes en el móvil', () => {
  test('el aviso, los proveedores y la carpeta, sin desbordes', async ({ page }) => {
    await entrar(page)
    await page.goto('/settings')
    await esperarApp(page)

    await expect(page.getByRole('heading', { level: 1, name: 'Ajustes' })).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Antes de copiar un plugin, lee esto' }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Leer el aviso de seguridad' })).toBeVisible()

    // Con un proveedor activo, sus mandos de orden están y el primero no sube.
    await expect(page.getByRole('heading', { name: 'Proveedores', exact: true })).toBeVisible()
    const subir = page.getByRole('button', { name: /^Subir / }).first()
    await expect(subir).toBeVisible()
    await expect(subir).toBeDisabled()

    await expect(page.getByRole('heading', { name: 'Proveedores de un repositorio' })).toBeVisible()
    await expect(page.getByRole('button', { name: /Usar proveedor predeterminado/ })).toBeVisible()

    expect(await desborde(page)).toBeLessThanOrEqual(0)
  })
})
