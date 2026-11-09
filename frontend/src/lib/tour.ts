/** Evento para abrir el recorrido guiado desde el menú de la cuenta (HU-30). */
export const TOUR_EVENT = 'stocksense:tour'
export const openTour = () => window.dispatchEvent(new Event(TOUR_EVENT))
