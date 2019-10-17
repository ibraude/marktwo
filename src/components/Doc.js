import React from 'react';
import './Doc.scss'
import $ from 'jquery';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import _ from 'lodash';
import marked from 'marked';
import stringify from 'json-stringify-deterministic';
import md5 from 'md5';
import moment from 'moment';
import shortid from 'shortid';
import syncUtils from './syncUtils';

class Doc extends React.Component {
  constructor(props) {
    super(props);

    this.sync = this.sync.bind(this);
    this.debouncedSync = _.debounce(this.sync, 5000);
    this.assembleDocFromMetaData = this.assembleDocFromMetaData.bind(this);
    this.initializeEditor = this.initializeEditor.bind(this);

    TurndownService.prototype.escape = text => text; // disable escaping characters
    this.turndownService = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-', codeBlockStyle: 'fenced' });
    this.turndownService.use(gfm);
    marked.setOptions({
      breaks: true,
      smartLists: true,
    })

    this.doc = {};

    this.state = { initialHtml: props.initialData ? marked(props.initialData) : '<p><br /></p>' };
  }

  assembleDocFromMetaData(docMetadata) {
    // assemble document
    return new Promise(resolve => {
      Promise.all(docMetadata.pageIds.map(pageId => this.syncUtils.findOrFetch(pageId)))
      .then(pages => {
        if(pages.length) {
          const docList = _.flatten(pages)
          document.querySelector('#m2-doc').innerHTML = docList.map(entry => marked(entry.text || '\u200B')).join('\n')
          Array.from(document.querySelector('#m2-doc').children).forEach((el, i) => {
            el.id = docList[i].id;
          });
          this.doc = {};
          docList.forEach(entry => this.doc[entry.id] = entry.text);
          document.getElementById(docMetadata.caretAt) && document.getElementById(docMetadata.caretAt).scrollIntoView();
          resolve();
        } else {
          document.querySelector('#m2-doc').innerHTML = '<p><br /></p>';
          resolve();
        }
      });
    })
  }

  sync() {
    console.log('syncing');

    let lines = [];
    $('#m2-doc > *').each((i, el) => {
      if(!el.id) {
        el.id = shortid.generate();
        this.doc[el.id] = this.turndownService.turndown(el.outerHTML);
      }
      lines.push(el.id);
    })

    const sel = window.getSelection();
    let caretAt = $(sel.anchorNode).closest('#m2-doc > *').attr('id');

    // creates the authoritative definition of the document, a list of ids with text,
    // and stores as blocks of data keyed by the hash of the data.
    const pages = {};
    const pageIds = []
    _.chunk(lines.map(id => ({ id, text: this.doc[id]})), 100).map(page => {
      const hash = md5(stringify(page));
      const id = `${this.props.currentDoc}.${hash}`;
      pages[id] = page;
      pageIds.push(id);
    })


    const docMetadata = JSON.parse(localStorage.getItem(this.props.currentDoc));

    // cache all pageIds
    pageIds.map(pageId => localStorage.setItem(pageId, JSON.stringify(pages[pageId])))

    // update page caches
    // if the page isn't cached, cache it
    _.difference(pageIds, docMetadata.pageIds).map(pageId => {
      this.syncUtils.create(pageId, pages[pageId]);
    });

    // if the page has been removed, remove it
    _.difference(docMetadata.pageIds, pageIds).map(pageId => {
       localStorage.removeItem(pageId);
       // TODO, remove old pages from server
    });

    docMetadata.caretAt = caretAt;
    docMetadata.pageIds = pageIds;
    docMetadata.lastModified = new Date().toISOString();

    this.syncUtils.syncByRevision(this.props.currentDoc, docMetadata).then(validatedDocMetadata => {
      if(!_.isEqual(docMetadata.pageIds, validatedDocMetadata.pageIds)) {
        this.assembleDocFromMetaData(validatedDocMetadata);
      }
    });
  }

  initializeEditor() {
    let selectedBlock;
    $('#m2-doc').on('keyup keydown mouseup', (e) => {
      this.debouncedSync();

      let oldSelectedBlock;
      if(selectedBlock) {
        oldSelectedBlock = selectedBlock;
      }

      let sel = window.getSelection();
      console.log('selection:');
      console.log(sel);
      console.log('anchorNode:');
      console.log(sel.anchorNode);
      const originalAnchorText = (sel.anchorNode && sel.anchorNode.data) ? sel.anchorNode.data.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&') : 0;
      selectedBlock = $(sel.anchorNode).closest('#m2-doc > *');
      console.log('selectedBlock:');
      console.log(selectedBlock);

      if(e.key === 'Enter' && e.type === 'keydown') {
        e.preventDefault();

        // if the current line is not empty, prevent default and continue the string in a newline
        if(selectedBlock && selectedBlock[0] && !(sel.anchorNode.data === '\n\u200B' || (sel.anchorNode.tagName === 'BR'))) {
        console.log(e);

        let range;
        if(sel.getRangeAt && sel.rangeCount) {
            range = sel.getRangeAt(0);
            range.deleteContents();
            range.insertNode(document.createTextNode('\n\u200B'));
            sel.anchorNode.nextSibling && sel.collapse(sel.anchorNode.nextSibling, sel.anchorNode.nextSibling.length);
        }
        } else {
          // if the line is empty, start a new paragraph
          const newBlock = $(`<p id=${shortid.generate()}><br /></p>`);
          newBlock.insertAfter(selectedBlock);
          sel.collapse(newBlock[0], 0);
        }
      }


      // enter edit mode, showing markdown
      console.log(selectedBlock.data('editMode'));
      if(selectedBlock && selectedBlock[0] && !selectedBlock.data('editMode')) {
        console.log('markdown:');
        console.log(selectedBlock[0] && this.turndownService.turndown(selectedBlock[0].outerHTML));

        console.log('selection before toggling to edit');
        console.log(sel)
        const anchorOffset = sel.anchorOffset;
        let renderedMarkdown;
        if(selectedBlock.attr('id')) {
          renderedMarkdown = this.doc[selectedBlock.attr('id')] || '<br />';
        } else {
          renderedMarkdown = this.turndownService.turndown(selectedBlock[0].outerHTML) || '<br />'
        }
        selectedBlock.html(renderedMarkdown);
        console.log('selection after toggling to edit');
        console.log(sel)
        var range = document.createRange();
        let offset;
        if(selectedBlock[0].firstChild && selectedBlock[0].firstChild.data) {
          const stringMatch = selectedBlock[0].firstChild.data.match(new RegExp(originalAnchorText));
          const stringIndex = stringMatch ? stringMatch.index : 0;
          offset = stringIndex + anchorOffset;
        } else {
          offset = 0;
        }
        range.setStart(selectedBlock[0].firstChild, Math.min(offset, selectedBlock[0].firstChild.length));
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        selectedBlock.data('editMode', true);
        selectedBlock.addClass('m2-edit-mode');
      }

      // render the old node upon exit
      if(oldSelectedBlock && oldSelectedBlock[0] && selectedBlock && selectedBlock[0] && !oldSelectedBlock[0].isSameNode(selectedBlock[0])) {
        console.log('rendered markdown:')
        let markdown = oldSelectedBlock[0].innerText.replace(/\u200B/g, '');
        console.log(markdown);
        console.log('html:');
        let html = marked(markdown);
        console.log(html);
        const renderedNode = $(html.replace(/\\/g, '') || '<p><br /></p>');
        let id = oldSelectedBlock.attr('id');
        if(!id) {
          id = shortid.generate();
        }
        renderedNode.attr('id', id);
        this.doc[id] = markdown.trim();
        console.log(this.doc);
        oldSelectedBlock.replaceWith(renderedNode);
      }

      // fixes bug with contenteditable where you completely empty the p if the document is empty
      if (e.key === 'Backspace' || e.key === 'Delete') {
          if(!document.querySelector('#m2-doc > *')) {
            document.querySelector('#m2-doc').innerHTML = `<p id="${shortid.generate()}"><br /></p>`;
          }
      }
    });
  }

  componentDidMount() {
    this.syncUtils = syncUtils(this.props.gapi);

    let docMetadataDefault = { pageIds: [], revision: 0 };

    this.syncUtils.initializeData(this.props.currentDoc, docMetadataDefault).then(docMetadata => {
      this.assembleDocFromMetaData(docMetadata).then(() => {
        this.initializeEditor();
        this.sync();
      })
    });
  }


  render() {
    return <div><div id="m2-doc" className="m2-doc content" contentEditable="true" dangerouslySetInnerHTML={ {__html: this.state.initialHtml} }></div></div>
  }
}

export default Doc;
