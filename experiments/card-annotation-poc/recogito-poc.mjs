import createDOMPurify from 'dompurify';
import {
  createTextAnnotator,
  rangeToSelector,
  splitAnnotatableRanges,
} from '@recogito/text-annotator';
import '@recogito/text-annotator/text-annotator.css';

const root = document.getElementById('card');
const DOMPurify = createDOMPurify(window);
root.innerHTML = DOMPurify.sanitize(
  '<p><ruby>食<rt class="not-annotatable">た</rt></ruby>べる'
    + '<button class="audio-btn not-annotatable" type="button">play</button></p>',
  { ADD_TAGS: ['ruby', 'rt'], ADD_ATTR: ['class', 'type'] }
);
const baseline = root.innerHTML;
const range = document.createRange();
range.selectNodeContents(root);
const rawSelectors = splitAnnotatableRanges(root, range).map((part) => rangeToSelector(part, root));
const selectors = rawSelectors.filter((selector) => selector.quote);
const annotator = createTextAnnotator(root);
const id = 'urn:ca-p2:recogito-ruby';
await annotator.addAnnotation({
  id,
  bodies: [],
  target: { annotation: id, selector: selectors },
});
const sourceClone = root.cloneNode(true);
sourceClone.querySelector('.r6o-span-highlight-layer')?.remove();

window.recogitoPoc = {
  annotationCount: annotator.getAnnotations().length,
  rawSelectorCount: rawSelectors.length,
  selectors: selectors.map(({ quote, start, end }) => ({ quote, start, end })),
  rubyText: root.querySelector('ruby')?.textContent,
  readingText: root.querySelector('rt')?.textContent,
  markupUnchanged: root.innerHTML === baseline,
  sourceMarkupUnchanged: sourceClone.innerHTML === baseline,
  highlightLayerCount: root.querySelectorAll('.r6o-span-highlight-layer').length,
  markupBefore: baseline,
  markupAfter: root.innerHTML,
  cssHighlightCount: CSS.highlights?.size ?? 0,
};
