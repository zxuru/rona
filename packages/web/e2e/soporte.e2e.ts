import { expect, test } from '@playwright/test'
import { entrar, esperarApp } from './fixtures'

/**
 * El reporte rápido del pie.
 *
 * Es el camino que no pasa por Ajustes: el botón abre un `<dialog>` nativo y el
 * formulario deja el borrador en GitHub. Lo que se mide aquí es lo que no se ve
 * en una prueba de servidor: que el diálogo se abra de verdad, que el foco vaya
 * al asunto, que `Esc` lo cierre y que la dirección lleve el texto escrito.
 *
 * No se pulsa el enlace del reporte: abriría GitHub de verdad.
 */
test.describe('el reporte del pie', () => {
  test('el botón abre el diálogo, enfoca el asunto y `Esc` lo cierra', async ({ page }) => {
    await entrar(page)
    await esperarApp(page)

    await page.getByRole('button', { name: 'Reportar un problema' }).click()

    const dialogo = page.getByRole('dialog', { name: 'Reportar un problema' })
    await expect(dialogo).toBeVisible()
    await expect(dialogo.getByLabel('Asunto')).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(dialogo).toBeHidden()
  })

  test('el borrador lleva el asunto, el cuerpo y el contexto', async ({ page }) => {
    await entrar(page)
    await esperarApp(page)

    await page.getByRole('button', { name: 'Reportar un problema' }).click()

    const dialogo = page.getByRole('dialog', { name: 'Reportar un problema' })
    await dialogo.getByLabel('Asunto').fill('No carga la portada')
    await dialogo.getByLabel('Qué ha pasado').fill('La imagen se queda en blanco al abrir la home.')

    const abrir = dialogo.getByRole('link', { name: 'Abrir el reporte en GitHub' })
    const href = await abrir.getAttribute('href')
    expect(href).not.toBeNull()

    const url = new URL(href ?? '')
    expect(url.origin + url.pathname).toBe('https://github.com/zxuru/rona/issues/new')
    expect(url.searchParams.get('title')).toBe('No carga la portada')
    expect(url.searchParams.get('body')).toContain('La imagen se queda en blanco')
    expect(url.searchParams.get('body')).toContain('Contexto de la instalación')
    expect(url.searchParams.get('body')).toContain('Pantalla: /')
  })

  test('el icono de GitHub del pie abre el repositorio', async ({ page }) => {
    await entrar(page)
    await esperarApp(page)

    const repositorio = page.getByRole('link', { name: 'Abrir el repositorio en GitHub' })
    await expect(repositorio).toHaveAttribute('href', 'https://github.com/zxuru/rona')
    await expect(repositorio).toHaveAttribute('target', '_blank')
  })
})
