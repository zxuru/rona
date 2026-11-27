/**
 * La versión de RonA para el contexto de un reporte.
 *
 * El formulario vive en dos sitios a la vez —la sección de Ajustes y el diálogo
 * del pie—, así que la lectura se comparte: una sola petición a `/api/health`,
 * la primera vez que alguno de los dos la necesita. Volver a pedirla por cada
 * formulario sería contar dos veces lo mismo.
 *
 * Un fallo no se propaga: el reporte sigue siendo útil sin la versión y el
 * contexto lo dice. Por eso la promesa se queda resuelta con `undefined` y no se
 * reintenta en cada montaje.
 */

import { healthResponseSchema } from '@rona/core/api'
import { useEffect, useState } from 'react'
import { apiGet } from '../../api/client'

const VERSION_TIMEOUT_MS = 4_000

let pendiente: Promise<string | undefined> | undefined

/** La versión, compartida por todas las instancias. */
export function versionDeRona(): Promise<string | undefined> {
  pendiente ??= apiGet('/api/health', healthResponseSchema, {
    timeoutMs: VERSION_TIMEOUT_MS,
  }).then(
    (salud) => salud.version,
    () => undefined,
  )

  return pendiente
}

/** La versión, reactiva para el componente. `undefined` mientras se sabe. */
export function useVersionDeRona(): string | undefined {
  const [version, setVersion] = useState<string | undefined>(undefined)

  useEffect(() => {
    let vivo = true

    void versionDeRona().then((valor) => {
      if (vivo && valor !== undefined) setVersion(valor)
    })

    return () => {
      vivo = false
    }
  }, [])

  return version
}
