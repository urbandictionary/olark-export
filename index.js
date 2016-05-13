import fs from 'fs'
import Rx from 'rx'
import request from 'request'
import cheerio from 'cheerio'
import cookieString from './olark-cookie'

let completed = false

const requestOptions = {
  timeout: 40000,
  headers: {
    Cookie: cookieString
  }
}
const ITEMS_ON_PAGE = 30

let parsePageWithLinks = (html) => {
  let links = []
  let $ = cheerio.load(html)

  $('.transcripts-wrapper').find('a').each(function(index, item) {
    links.push(`https://www.olark.com${item.attribs.href}`)
  })
  console.log(`Extracted ${links.length} links`)
  return links
}

let downloadPageWithLinks = (url) => new Promise((resolve, reject) => {
  console.log(`Crawling page #${url}`)
  request.get(url, requestOptions, (err, resp, body) => {
    if (err) return reject(err)
    if (body.indexOf('We couldn\'t find any transcript results to match your search.\n</div>') > -1) {
      console.log('Pagination end reached')
      completed = true
      return resolve(null)
    }
    resolve(body)
  })
})

let downloadLink = (url) => new Promise((resolve, reject) => {
  console.log(`Getting ${url}`)
  request.get(url, requestOptions, (err, resp, body) => {
    if (err || !body.length) {
      console.log(`Got empty body.. Waiting`)
      reject()
    } else {
      resolve({
        html: body,
        url: url
      })
    }
  })
})

let parseLink = (obj) => {
  let $ = cheerio.load(obj.html)

  let divHTML = $('div.transcripts-module').html()

  return {
    url: obj.url,
    data: `<div class="transcripts-module">${divHTML}</div>`
  }
}

let saveToFile = (obj) => {
  let filename = `${obj.url.split('/').pop()}.html`
  fs.writeFile(`transcripts/${filename}`, obj.data, () => {
    console.log(`${filename} saved`)
  })
  return filename
}

let startFromPage = 0

Rx.Observable
  .return(startFromPage)
  .map(_ => `https://www.olark.com/transcripts/show?start_position=${startFromPage++ * ITEMS_ON_PAGE}`)
  .flatMap(_ => Rx.Observable.defer(() => downloadPageWithLinks(_)))
  .doWhile(_ => !completed)
  .filter(_ => _)
  // .take(3)
  .flatMap(_ => parsePageWithLinks(_))
  .flatMapWithMaxConcurrent(5, _ => Rx.Observable.defer(() => downloadLink(_)).retryWhen(e => e.delay(8000)))
  .map(_ => parseLink(_))
  .map(_ => saveToFile(_))
  .subscribe((data) => {}, (err) => {
    console.log('err', err)
  }, () => {
    console.log('completed')
  })
