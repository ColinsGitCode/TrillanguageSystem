export type CardAnnotationSelector = {
  projectionVersion: string;
  textQuote: {
    type: 'TextQuoteSelector';
    exact: string;
    prefix: string;
    suffix: string;
  };
  textPosition: {
    type: 'TextPositionSelector';
    start: number;
    end: number;
  };
};

export type RenderableCardAnnotation = {
  id: string;
  selector: CardAnnotationSelector;
  annotationKind: 'highlight' | 'note';
  color: 'red' | 'yellow' | 'green' | 'blue' | null;
  status: 'active' | 'orphaned' | 'deleted';
};

export function applyAnnotationRange(
  root: HTMLElement,
  range: Range,
  annotation: RenderableCardAnnotation
): boolean;

export function applyAnnotations(
  root: HTMLElement,
  annotations?: RenderableCardAnnotation[]
): Array<{ id: string; status: 'rendered' | 'orphaned'; resolution: string }>;
