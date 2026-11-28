/**
 * Una consulta de medios, viva.
 *
 * Se pregunta al montar y se escucha el cambio: girar el teléfono, encoger la
 * ventana o enchufar un ratón tienen que cambiar lo que se pinta sin recargar la
 * página. La primera respuesta llega en un efecto y no en el render, así que en el
 * servidor —donde no hay `window`— vale «no» y se corrige en el primer efecto,
 * que es antes de que el video tenga imagen.
 *
 * La consulta llega como argumento porque no todas son de ancho: `pointer` y
 * `orientation` cambian con el aparato y con su postura, y son las que deciden qué
 * mandos existen en un teléfono.
 */

import { useEffect, useState } from 'react'

export function useConsultaDeMedios(consulta: string): boolean {
  const [cumple, setCumple] = useState(false)

  useEffect(() => {
    const medios = window.matchMedia(consulta)
    const alCambiar = (): void => setCumple(medios.matches)

    alCambiar()
    medios.addEventListener('change', alCambiar)

    return () => medios.removeEventListener('change', alCambiar)
  }, [consulta])

  return cumple
}
