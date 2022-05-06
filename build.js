const _ = require('lodash')
const { promises: fsPromises } = require('fs')
const axios = require('axios')
const dayjs = require('dayjs')
const Joi = require('joi')
const Papa = require('papaparse')
const path = require('path')

dayjs.extend(require('dayjs/plugin/utc'))

exports.build = async () => {
  await fsPromises.mkdir(path.resolve(__dirname, 'dist'), { recursive: true })
  await Promise.all([
    fsPromises.writeFile( // 診所看診時間
      path.resolve(__dirname, 'dist/opens.csv'),
      Papa.unparse(await exports.fetchOpens(), { header: true })
    ),
    fsPromises.writeFile( // 快篩實名制凌晨備份
      path.resolve(__dirname, 'dist/stores0430.csv'),
      Papa.unparse(await exports.fetchStores(), { header: true })
    ),
  ])
}

exports.fetchOpens = async () => {
  const rows = await exports.getCsv('https://data.nhi.gov.tw/resource/Opendata/%E5%85%A8%E6%B0%91%E5%81%A5%E5%BA%B7%E4%BF%9D%E9%9A%AA%E7%89%B9%E7%B4%84%E9%99%A2%E6%89%80%E5%9B%BA%E5%AE%9A%E6%9C%8D%E5%8B%99%E6%99%82%E6%AE%B5.csv')
  const opens = []
  const schema = Joi.object({
    id: Joi.string().alphanum().required(),
    name: Joi.string().trim().required(),
    time: Joi.string().replace(/N/g, '1').replace(/Y/g, '0').regex(/^[01]{21}$/).empty('').default(''),
    notice: Joi.string().trim().empty(Joi.any().equal('-', '')).default(''),
    opened: Joi.string().trim().equal('0').strip(),
  })
  let errCnt = 0
  for (const row of rows) {
    try {
      opens.push(await schema.validateAsync({
        id: row['醫事機構代碼'],
        name: row['醫事機構名稱'],
        time: row['看診星期'],
        notice: row['看診備註'],
        opened: row['開業狀況'],
      }, { stripUnknown: true }))
    } catch (err) {
      errCnt++
    }
  }
  if (errCnt) console.log(`fetchOpens 有 ${errCnt} 筆錯誤資料`)
  return opens
}

exports.fetchOldStores = async () => {
  const rows = await this.getCsv('https://taichunmin.idv.tw/covid19-testkit-maps-crawler/stores0430.csv')
  const tsToday = dayjs().utcOffset(8).startOf('day')
  return _.filter(rows, row => dayjs.unix(row.updatedAt) > tsToday)
}

exports.fetchNhiStores = async () => {
  const rows = await this.getCsv('https://data.nhi.gov.tw/resource/Nhi_Fst/Fstdata.csv')
  const stores = []
  const schema = Joi.object({
    addr: Joi.string().trim().required(),
    amount: Joi.number().integer().min(0).required(),
    id: Joi.string().alphanum().required(),
    lat: Joi.number().min(21).max(28).empty('0').required(),
    lng: Joi.number().min(117).max(123).empty('0').required(),
    name: Joi.string().trim().required(),
    notice: Joi.string().trim().empty(Joi.any().equal('-', '')).default(''),
    tel: Joi.string().trim().required(),
    testkit: Joi.string().trim().required(),
    updatedAt: Joi.any().required(),
  })
  const CHAR_MAP = _.zipObject('０１２３４５６７８９／：；（）～〜。\n'.split(''), '0123456789/:;()~~;;'.split(''))
  const strtr = (str, charmap) => _.map(str, c => _.get(charmap, [c], c)).join('')
  let errCnt = 0
  for (const row of rows) {
    try {
      const updatedAt = dayjs(`${row['來源資料時間']}+0800`, 'YYYY/MM/DD HH:mm:ssZZ')
      if (!updatedAt.isValid()) throw new Error('時間錯誤')
      const store = await schema.validateAsync({
        addr: row['醫事機構地址'],
        amount: row['快篩試劑截至目前結餘存貨數量'],
        id: row['醫事機構代碼'],
        lat: row['緯度'],
        lng: row['經度'],
        name: row['醫事機構名稱'],
        notice: row['備註'],
        tel: row['醫事機構電話'],
        testkit: row['廠牌項目'],
        updatedAt: updatedAt.unix(),
      }, { stripUnknown: true })
      for (const k of ['addr', 'notice', 'tel']) store[k] = strtr(store[k], CHAR_MAP)
      stores.push(store)
    } catch (err) {
      errCnt++
    }
  }
  if (errCnt) console.log(`fetchNhiStores 有 ${errCnt} 筆錯誤資料`)
  return stores
}

exports.fetchStores = async () => {
  const [nhiStores, oldStores] = await Promise.all([
    exports.fetchNhiStores(),
    exports.fetchOldStores(),
  ])
  const mergedStores = new Map()
  for (const store of [...oldStores, ...nhiStores]) {
    const tmp = mergedStores.get(store.id) ?? {}
    mergedStores.set(store.id, {
      ...tmp,
      ...store,
      amount: Math.max(store.amount, _.toSafeInteger(tmp.amount)),
    })
  }
  return [...mergedStores.values()]
}

exports.getCsv = async (url, cachetime = 3e4) => {
  const csv = _.trim(_.get(await axios.get(url, {
    params: { cachebust: _.floor(Date.now() / cachetime) },
  }), 'data'))
  return _.get(Papa.parse(csv, {
    encoding: 'utf8',
    header: true,
  }), 'data', [])
}
