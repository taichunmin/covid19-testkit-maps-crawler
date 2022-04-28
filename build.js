const _ = require('lodash')
const { promises: fsPromises } = require('fs')
const axios = require('axios')
const dayjs = require('dayjs')
const Joi = require('joi')
const Papa = require('papaparse')
const path = require('path')

exports.build = async () => {
  await fsPromises.mkdir(path.resolve(__dirname, 'dist'), { recursive: true })
  // 診所看診時間
  await fsPromises.writeFile(
    path.resolve(__dirname, 'dist/opens.csv'),
    Papa.unparse(await exports.fetchOpens(), { header: true })
  )
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

exports.getCsv = async (url, cachetime = 3e4) => {
  const csv = _.trim(_.get(await axios.get(url, {
    params: { cachebust: _.floor(Date.now() / cachetime) },
  }), 'data'))
  return _.get(Papa.parse(csv, {
    encoding: 'utf8',
    header: true,
  }), 'data', [])
}
