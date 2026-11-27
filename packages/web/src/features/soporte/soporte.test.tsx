import { describe, expect, test } from 'bun:test'
import { renderToString } from 'react-dom/server'
import { AccionesDelPie } from './AccionesDelPie'
import { FormularioReporte } from './FormularioReporte'
import { ReporteDialog } from './ReporteDialog'
import { ReporteRapido } from './ReporteRapido'
import { SoporteSettings } from './SoporteSettings'
import {
  cuerpoDelReporte,
  entornoDeVentana,
  INCIDENCIAS,
  NUEVA_INCIDENCIA,
  REPOSITORIO,
  urlDelReporte,
  type VentanaDelNavegador,
} from './soporte'

/**
 * El reporte de un problema.
 *
 * Lo que se mide aquí es la parte que decide: la dirección que se abre, el
 * contexto que se adjunta y que el marcado ofrezca el repositorio y el
 * formulario. La pestaña nueva y lo que GitHub hace con el borrador piden un
 * navegador y no se simulan.
 */

const VENTANA: VentanaDelNavegador = {
  location: { pathname: '/settings' },
  navigator: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
  innerWidth: 1280,
  innerHeight: 720,
}

describe('el contexto de la instalación', () => {
  test('sin ventana no hay contexto: en el servidor no se inventa', () => {
    expect(entornoDeVentana(undefined, '0.11.4')).toBeUndefined()
  })

  test('copia ruta, navegador y ventana, y la versión cuando se sabe', () => {
    expect(entornoDeVentana(VENTANA, '0.11.4')).toEqual({
      version: '0.11.4',
      ruta: '/settings',
      navegador: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      ancho: 1280,
      alto: 720,
    })
  })

  test('sin versión no deja una clave vacía', () => {
    const entorno = entornoDeVentana(VENTANA)

    expect(entorno).toBeDefined()
    expect(entorno === undefined ? true : 'version' in entorno).toBe(false)
  })
})

describe('el cuerpo del reporte', () => {
  test('sin contexto es la descripción tal cual, sin filetes colgando', () => {
    expect(cuerpoDelReporte('  Se cierra al abrir un episodio.\n', '')).toBe(
      'Se cierra al abrir un episodio.',
    )
  })

  test('con contexto lo separa con un filete y recorta los dos extremos', () => {
    expect(cuerpoDelReporte('  Falla la búsqueda. ', ' Contexto\n')).toBe(
      'Falla la búsqueda.\n\n---\n\nContexto',
    )
  })

  test('el contexto solo también es un cuerpo válido', () => {
    expect(cuerpoDelReporte('', 'Contexto')).toBe('Contexto')
  })
})

describe('la dirección del borrador', () => {
  test('sin texto va a la página de nueva incidencia, sin consulta vacía', () => {
    expect(urlDelReporte('  ', '  ')).toBe(NUEVA_INCIDENCIA)
  })

  test('lleva el asunto y el cuerpo en la consulta, codificados', () => {
    const url = urlDelReporte('No abre & se cierra', 'Línea uno\nLínea dos #2')
    const partes = new URL(url)

    expect(partes.origin + partes.pathname).toBe(NUEVA_INCIDENCIA)
    expect(partes.searchParams.get('title')).toBe('No abre & se cierra')
    expect(partes.searchParams.get('body')).toBe('Línea uno\nLínea dos #2')
    // Los espacios y los acentos no van crudos: la dirección tiene que poder
    // copiarse y pegarse en un navegador sin romperse.
    expect(url).not.toContain(' ')
    expect(url).toContain('%C3%AD')
  })

  test('recorta el asunto y el cuerpo antes de codificarlos', () => {
    const partes = new URL(urlDelReporte('  Título  ', '  Cuerpo  '))

    expect(partes.searchParams.get('title')).toBe('Título')
    expect(partes.searchParams.get('body')).toBe('Cuerpo')
  })
})

describe('la sección de Soporte', () => {
  test('enseña el repositorio con su icono y el enlace a las incidencias', () => {
    const html = renderToString(<SoporteSettings />)

    expect(html).toContain(`href="${REPOSITORIO}"`)
    expect(html).toContain(`href="${INCIDENCIAS}"`)
    expect(html).toContain('zxuru/rona')
    expect(html).toContain('Ver las incidencias abiertas')
    // El icono de GitHub es decorativo: el nombre accesible lo pone el texto.
    expect(html).toContain('aria-hidden="true"')
  })

  test('ofrece el formulario y el enlace que abre el borrador', () => {
    const html = renderToString(<SoporteSettings />)

    expect(html).toContain('Reportar un problema')
    expect(html).toContain('Qué ha pasado')
    expect(html).toContain('Adjuntar datos de la instalación')
    expect(html).toContain(`href="${NUEVA_INCIDENCIA}"`)
    expect(html).toContain('Abrir el reporte en GitHub')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noreferrer noopener"')
  })

  test('los dos campos tienen tope y el asunto se declara', () => {
    const html = renderToString(<SoporteSettings />)

    expect(html).toContain('maxLength="120"')
    expect(html).toContain('maxLength="2000"')
    expect(html).toContain('id="soporte-descripcion-ayuda"')
  })
})

describe('el formulario, compartido', () => {
  test('los ids llevan el prefijo de su instancia', () => {
    const html = renderToString(<FormularioReporte idPrefijo="reporte" />)

    expect(html).toContain('id="reporte-descripcion-ayuda"')
    expect(html).not.toContain('id="soporte-descripcion-ayuda"')
  })

  test('dos formularios a la vez no repiten los ids de sus ayudas', () => {
    const html = renderToString(
      <>
        <FormularioReporte idPrefijo="soporte" />
        <FormularioReporte idPrefijo="reporte" />
      </>,
    )

    // Cada ayuda aparece una sola vez: el segundo formulario no puede apuntar
    // con `aria-describedby` a la ayuda del primero.
    expect((html.match(/id="soporte-descripcion-ayuda"/g) ?? []).length).toBe(1)
    expect((html.match(/id="reporte-descripcion-ayuda"/g) ?? []).length).toBe(1)
  })
})

describe('el diálogo del pie', () => {
  test('es un diálogo nativo con su título y el formulario dentro', () => {
    const html = renderToString(<ReporteDialog open onClose={() => {}} />)

    expect(html).toContain('<dialog')
    expect(html).toContain('aria-labelledby="reporte-titulo"')
    expect(html).toContain('id="reporte-titulo"')
    expect(html).toContain('Reportar un problema')
    expect(html).toContain('id="reporte-descripcion-ayuda"')
    expect(html).toContain('Cerrar')
  })

  test('cerrado no monta el formulario: el pie no pide la versión hasta abrirlo', () => {
    const html = renderToString(<ReporteDialog open={false} onClose={() => {}} />)

    expect(html).toContain('aria-labelledby="reporte-titulo"')
    expect(html).not.toContain('id="reporte-descripcion-ayuda"')
  })

  test('el pie ofrece el GitHub y el botón que abre el diálogo', () => {
    const html = renderToString(<AccionesDelPie />)

    expect(html).toContain(`href="${REPOSITORIO}"`)
    expect(html).toContain('aria-label="Abrir el repositorio en GitHub"')
    expect(html).toContain('aria-haspopup="dialog"')
    expect(html).toContain('Reportar un problema')
    // El mismo diálogo vive al lado del botón, cerrado hasta que se pulsa.
    expect(html).toContain('aria-labelledby="reporte-pie-titulo"')
  })
})

describe('el reporte en las pantallas de reproducción', () => {
  test('el mando compacto lleva su nombre accesible y su diálogo', () => {
    const html = renderToString(<ReporteRapido variante="icono" />)

    expect(html).toContain('class="reporte-rapido__icono"')
    expect(html).toContain('aria-label="Reportar un problema"')
    expect(html).toContain('title="Reportar un problema"')
    expect(html).toContain('aria-haspopup="dialog"')
    expect(html).toContain('aria-labelledby="reporte-icono-titulo"')
  })

  test('el enlace del reproductor no engorda la fila', () => {
    const html = renderToString(<ReporteRapido variante="enlace" />)

    // La tinta es "Reportar" y el nombre accesible, el entero.
    expect(html).toContain('class="reporte-rapido__enlace"')
    expect(html).toContain('aria-label="Reportar un problema"')
    expect(html).toContain('>Reportar<')
    expect(html).toContain('aria-labelledby="reporte-enlace-titulo"')
  })

  test('cada instancia usa un prefijo de ids distinto', () => {
    const html = renderToString(
      <>
        <ReporteRapido variante="pie" />
        <ReporteRapido variante="icono" />
      </>,
    )

    expect(html).toContain('id="reporte-pie-titulo"')
    expect(html).toContain('id="reporte-icono-titulo"')
    expect((html.match(/id="reporte-pie-titulo"/g) ?? []).length).toBe(1)
    expect((html.match(/id="reporte-icono-titulo"/g) ?? []).length).toBe(1)
  })
})
