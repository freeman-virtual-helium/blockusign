import { Injectable } from '@angular/core';
import { Document, Log, Message } from './../models/models';
import 'rxjs/add/operator/toPromise';
import { Http, Response } from '@angular/http';
import { Observable } from 'rxjs/Observable';
import 'rxjs/add/operator/map';
import 'rxjs/add/operator/catch';
import { AnonymousSubject } from 'rxjs/Subject';
import { Events } from 'ionic-angular';
import * as moment from 'moment';
import * as Automerge from 'automerge/dist/automerge.js';
//const Automerge = require('automerge');
declare let blockstack: any;
declare let sjcl: any;
declare let $: any;

/*
  Generated class for the StorageServiceProvider provider.

  See https://angular.io/guide/dependency-injection for more info on providers
  and Angular DI.
*/
@Injectable()
export class DocumentService {

  private indexFileName = "blockusign/documents.index.json";
  public documentsList: Array<Document>;
  public docBuffer: any;
  public currentDoc: Document;
  public currentDocAnnotations;
  public log: Log;
  public automerge = Automerge;

  constructor(public events: Events) {
    console.log('Hello StorageServiceProvider Provider');
    this.documentsList = [];

    // @TODO - think about putting in checks here is documentsList is empty, 
    // or there could be a async race issue if they take too long to come back
    this.getDocumentsIndex(true).then((data) => {
      this.documentsList = data;
    });
  }

  async getDocumentsIndex(refresh: boolean) {
    if (refresh) {
      let resp = await blockstack.getFile(this.indexFileName, { decrypt: true });
      if (resp) {
        this.documentsList = JSON.parse(resp);
      }
      if (this.documentsList == null || !resp) {
        this.documentsList = JSON.parse(await blockstack.putFile(this.indexFileName, "[]", { encrypt: true }));
      }
    }
    return this.documentsList;
  }


  async addDocument(fileName: string, fileBuffer: any) {
    let newDocument = new Document();
    newDocument.fileName = fileName;
    newDocument.documentKey = this.generateKey();
    newDocument.pathAnnotatedDoc = blockstack.loadUserData().profile.apps[window.location.origin];
    this.documentsList.push(newDocument);
    await blockstack.putFile(this.indexFileName, JSON.stringify(this.documentsList), { encrypt: true });
    this.docBuffer = fileBuffer;
    this.currentDoc = newDocument;
    let response = await this.addDocumentBytes(newDocument.guid, fileBuffer, newDocument.documentKey);
    return this.documentsList;
  }

  async removeDocument(document) {
    // remove item
    this.documentsList = (<any>this.documentsList).remove(document);
    await blockstack.putFile(this.indexFileName, JSON.stringify(this.documentsList), { encrypt: true });
    await this.removeDocumentBytes(document.guid);
    // remove binary file
    return this.documentsList;
  }

  async addDocumentBytes(guid: string, doc: any, documentKey: string) {
    let encryptedDoc = this.ecryptDoc(doc, documentKey);
    // add blank annotations file
    await this.saveAnnotations(guid, "");
    // add blank log file
    await this.getLog(guid);
    return blockstack.putFile(guid + ".pdf", encryptedDoc, { encrypt: false }).then((data) => { });
  }

  async getDocument(fileName: string, documentKey: string) {
    let resp = await blockstack.getFile(fileName, { decrypt: false });
    if (resp) {
      let encryptedDoc = resp;
      return this.decryptDoc(encryptedDoc, documentKey);
    }
    else {
      return null;
    }
  }

  async removeDocumentBytes(guid: string) {
    await blockstack.putFile(guid + ".annotations.json", "", { encrypt: false });
    await blockstack.putFile(guid + ".log.json", "", { encrypt: false });
    return blockstack.putFile(guid + ".pdf", "", { encrypt: false }).then((data) => { });
  }

  async saveAnnotations(guid: string, annotation: string) {
    let json = {
      annotations: annotation
    }
    return await blockstack.putFile(guid + ".annotations.json", JSON.stringify(json), { encrypt: false });
  }

  async getAnnotations(guid: string) {
    let resp = await blockstack.getFile(guid + ".annotations.json", { decrypt: false });
    if (resp) {
      this.currentDocAnnotations = JSON.parse(resp);
    }
    if (!resp) {
      this.currentDocAnnotations = "";
    }
    return this.currentDocAnnotations;
  }

  setCurrentDoc(guid: string) {
    //alert('set curr doc');
    this.currentDoc = this.documentsList.find(x => x.guid == guid);
    this.events.publish('documentService:setCurrentDoc', this.currentDoc);
    let span = "span:contains('" + this.currentDoc.fileName + "')";
    $(document).ready(function () {
      $(".channels-list-text li").removeClass('active');
      let s = $(span);
      s.parent().addClass('active');
    });
  }


  //#region Chat log
  async getLog(guid: string) {
    let logFileName = guid + '.log.json';
    let resp;
    try {
      resp = await blockstack.getFile(logFileName, { decrypt: false });
      if (resp) {
        this.log = JSON.parse(resp);
      }
      else {
        let newLog = new Log();
        newLog.messages = [];
        this.log = JSON.parse(await blockstack.putFile(logFileName, JSON.stringify(newLog), { encrypt: false }));
      }
      return this.log;
    }
    catch (e) {
      //throw e;
    }
  }

  async addMessage(guid: string, message: string) {
    let logFileName = guid + ".log.json"
    let log = await this.getLog(guid);
    if (log) {
      let msg = new Message();
      msg.message = message;
      msg.createdBy = blockstack.loadUserData().username;
      msg.createdByName = blockstack.loadUserData().profile.name;
      log.messages.push(msg);
      this.events.publish('documentService:addedChat', msg);
      return await blockstack.putFile(logFileName, JSON.stringify(log), { encrypt: false });
    }
    else {
      console.error("error getting log file: " + logFileName)
    }
  }
  //#endregion


  //#region Encryption
  //https://stackoverflow.com/questions/26734033/encrypting-files-with-sjcl-client-side
  ecryptDoc(doc: any, key: string) {
    let docBits = sjcl.codec.arrayBuffer.toBits(doc);
    let base64bits = sjcl.codec.base64.fromBits(docBits);
    let encryptedDoc = sjcl.encrypt(key, base64bits);
    return encryptedDoc;
  }
  decryptDoc(encryptedDoc, key: string) {
    let dec = sjcl.decrypt(key, encryptedDoc);
    let decryptedBase64 = sjcl.codec.base64.toBits(dec);
    let decryptedDocBits = sjcl.codec.arrayBuffer.fromBits(decryptedBase64);
    return decryptedDocBits;
  }
  generateKey() {
    return (<any>window).guid();
  }
  //#endregion



  // watchout
  async resetStorage() {
    await blockstack.putFile(this.indexFileName, "[]", { encrypt: true });
  }


  testAutoMerge() {

    // // fetch from server state for Nick
    // let doc1Nick = [{ 'who': 'nick' }];

    // // init doc
    // let doc1 = Automerge.init();
    // let commitMsg = 'Initialize doc from server for nick - ' + this.getDate();
    // doc1 = Automerge.change(doc1, commitMsg , doc => {
    //   doc = doc1Nick;
    // });

    // console.log(doc1);

    // // nick adds a row
    // commitMsg = 'Nick adds a row - ' + this.getDate;
    // doc1 = Automerge.change(doc1, 'Add card', doc => {
    //   doc.push({'who': 'nick2'});
    // });

    // console.log(doc1);


    // // Now let's simulate another device, whose application state is doc2. We
    // // initialise it separately, and merge doc1 into it. After merging, doc2 has
    // // a copy of all the cards in doc1.
    // // fetch from server state for Blockusign

    // let doc1Blockusign1 = [{ 'who': 'nick' }, {'who': 'Blocusign1'}];

  }

  getDate() {
    let d = Date();
    return d;
  }




  doc;
  docMine;
  docYours;
  
  test(){
    this.init1Doc();
    this.save2Mine();
    this.save3Yours();
    this.save4Mine();
    this.sync();
  }

  init1Doc(){
     // init doc
     this.docMine = Automerge.init();
     let commitMsg = 'initDoc - ' + this.getDate();
     this.docMine = Automerge.change(this.docMine, commitMsg , doc => {
      //let msg = new Message(); 
     // msg.
      //doc.chat = [msg];
     });
     return this.docMine;
  }

  save2Mine(){
    this.docMine = Automerge.change(this.docMine, 'save1Me - ' + this.getDate(), doc => {
      doc.chat.push({'me': '2'});
    });
    console.log(this.docMine);
    return this.docMine;
  }

  save3Yours(){
    this.docYours = Automerge.init()
    this.docYours = Automerge.merge(this.docYours, this.docMine);

    this.docYours = Automerge.change(this.docYours, 'save2Yours - ' + this.getDate() , doc => {
      doc.chat.push({'yours': '3'});
    });

    console.log(this.docYours);
    return this.docYours;
  }


  save4Mine(){
    this.docMine = Automerge.change(this.docMine, 'save3Me - ' + this.getDate(), doc => {
      doc.chat.push({'me': '4'});
    });
    return this.docMine;
  }

  sync(){
    this.doc = Automerge.merge(this.docMine, this.docYours);
    console.log(this.doc);
    return this.doc;
  }

}
