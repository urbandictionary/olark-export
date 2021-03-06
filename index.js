import fs from 'fs'
import Rx from 'rx'
import request from 'request'
import cheerio from 'cheerio'
import cookieString from './olark-cookie'

let completed = false

const requestOptions = {
  timeout: 40000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:49.0) Gecko/20100101 Firefox/49.0',
    'Cookie': cookieString
  }
}
const ITEMS_ON_PAGE = 30
const WAIT_TIMEOUT = 8000
let getTranscriptName = (url) => `${url.split('/').pop()}.html`

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
  console.log(`Crawling page with items: ${url}`)
  request.get(url, requestOptions, (err, resp, body) => {
    if (err || !body.length) return reject(err)
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
  let filename = getTranscriptName(obj.url)
  fs.writeFile(`transcripts/${filename}`, obj.data, () => {
    console.log(`${filename} saved`)
  })
  return filename
}

let transcriptAlreadyExist = (url) => {
  let filename = getTranscriptName(url)
  try {
    fs.accessSync(`transcripts/${filename}`)
    return true
  } catch (e) {
    return false
  }
}

let startFromPage = 0

Rx.Observable
  .return(startFromPage)
  .map(_ => `https://www.olark.com/transcripts/show?start_position=${startFromPage++ * ITEMS_ON_PAGE}`)
  .flatMap(_ => Rx.Observable.defer(() => downloadPageWithLinks(_)).retryWhen(e => e.delay(WAIT_TIMEOUT)))
  .doWhile(_ => !completed)
  .filter(_ => _)
  // .take(3)
  .flatMap(_ => parsePageWithLinks(_))
  .filter(_ => !transcriptAlreadyExist(_))
  .flatMapWithMaxConcurrent(5, _ => Rx.Observable.defer(() => downloadLink(_)).retryWhen(e => e.delay(WAIT_TIMEOUT)))
  .map(_ => parseLink(_))
  .map(_ => saveToFile(_))
  .subscribe((data) => {}, (err) => {
    console.log('err', err)
  }, () => {
    console.log('completed')
  })
