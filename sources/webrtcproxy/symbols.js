/* eslint-disable no-redeclare */
/* eslint-disable no-var */
/*
Functions tests Dealing with symbols converting them to string and back.
Goal is to able to create a sequalize style query as a valid json object  using placeholder strings.
Than sendit to to proxy which will convert it to a valid symbols and execute the query.

//sample logic:
// var original= {where:{
//   "<or>":{
//     "<lt>":"10",
//     "<gt>":"5",
//   }
// }}

//create  partsarray with the different layers of symbols
//Level:1,  sign: <lt>,      value:sym(lt):10                     ,paths backwords 10=<lt>.<or>.where
//Level:1,  sign: <gt>,      value:sym(gt):5                      ,paths backwords 5=<gt>.<or>.where
//Level:2,  sign: <or>,      value:sym(or):(sym(lt):A,sym(gt):B)  ,paths backwords <or>.where

once nested symbol parts array is generted,then assemble the query object.
*/
// const Sequelize = require('sequelize')
const { Op } = require('sequelize')
const _ = require('lodash')

//
const symbolise = (clientrequest) => {
  var paths = iterate(clientrequest)
  const partsarray = []
  let onepart = {}

  let maxpathlength = 0
  for (let g = 0; g < paths.length; g++) {
    var path = paths[g].substr(1)
    const numberofsymbols = path.match(/<[a-z]*>/g).length
    if (numberofsymbols > maxpathlength) {
      maxpathlength = numberofsymbols
    }
  }
  maxpathlength = parseInt(maxpathlength)

  for (let i = 0; i < maxpathlength; i++) {
    for (let j = 0; j < paths.length; j++) {
      var path = paths[j].substr(1)
      const symbols = path.match(/<[a-z]*>/g).reverse()
      var justpath = path.split('=')[0]
      var justvalue = path.split('=')[1]
      for (let k = i; k < i + 1; k++) {
        const currentsymbol = symbols[k]
        const CurrentSymPath = path.substr(0, path.lastIndexOf(currentsymbol)) + currentsymbol
        const temp = justpath.substring(0, justpath.lastIndexOf(currentsymbol) - 1)
        const revpath = temp.split('.').reverse().toString().replace(/[,]/g, '.')

        if ((i === 0) && (symbols.length === 1)) {
          // example matches : ".where.<or>.0.id=12",".where.<or>.1.id=13"
          var computedvalue = {}
          for (var m = 0; m < paths.length; m++) {
            var path = paths[m].substr(1)
            var justpath = path.split('=')[0]
            var justvalue = path.split('=')[1]
            var subpath = justpath.substring(justpath.lastIndexOf(currentsymbol)).replace(currentsymbol + '.', '')
            if (subpath === currentsymbol) {
              var computedvalue = justvalue
            } else {
              _.set(computedvalue, subpath, justvalue)
            }
          }
        } else if (i === 0) {
          var computedvalue = justvalue
        } else {
          const partsarraylvli = _.filter(partsarray, {
            level: i
          })
          var searchpatt = new RegExp(CurrentSymPath + '.*')
          const childelements = _.filter(partsarraylvli, obj => searchpatt.test(obj.path))
          // var temparray=[]
          var computedvalue = {}
          const tempobject = {}
          if (childelements.length > 1) {
            for (var l = 0; l < childelements.length; l++) {
              var p = childelements[l].revpath
              var subpath = p.substring(0, p.lastIndexOf(currentsymbol) - 1).split('.').reverse().toString().replace(/[,]/g, '.')

              if (subpath === '') {
                tempobject[Object.getOwnPropertySymbols(childelements[l].value)[0]] = childelements[l].value
              } else {
                _.set(tempobject, subpath, childelements[l].value)
              }
              _.remove(partsarray, childelements[l])
            }
            computedvalue = tempobject
          } else if (childelements.length !== 0) {
            var p = childelements[l].revpath
            var subpath = p.substring(0, p.lastIndexOf(currentsymbol) - 1).split('.').reverse().toString().replace(/[,]/g, '.')
            _.set(computedvalue, subpath, childelements[l].value)
            _.remove(partsarray, childelements[l])
          }
        } // else

        if (!(_.isEmpty(computedvalue)) || (Object.getOwnPropertySymbols(computedvalue).length > 0)) {
          const onepartvalue = symbolconverter(currentsymbol, computedvalue)
          onepart = {
            level: parseInt(k + 1), // 1
            sign: currentsymbol, // <lt>
            value: onepartvalue, // sym(lt):10
            revpath, // '<lt>.<or>.rank.where'
            path: CurrentSymPath
          }

          const itemcheck = _.find(partsarray, {
            sign: currentsymbol,
            level: (k + 1),
            path: CurrentSymPath
          }) //
          if (itemcheck === undefined) {
            partsarray.push(onepart)
          }
        }
      } // for internal
    } // for middle
  } // for external

  const object = {}
  const beenthere = []
  for (var m = 0; m < paths.length; m++) {
    var path = paths[m]
    const firstsymbol = path.match(/<[a-z]*>/g)[0]

    const objectpath = path.substr(0, path.lastIndexOf(firstsymbol) - 1)
    var fromIndex = 0
    if (!(_.includes(beenthere, objectpath, [fromIndex]))) {
      beenthere.push(objectpath)
      const searchpath = objectpath.substr(1) + '.' + firstsymbol

      const symbolvalue = _.find(partsarray, {
        sign: firstsymbol,
        path: searchpath
      }).value
      _.set(object, objectpath.substring(1), symbolvalue)
    }
  }
  console.log(object)
  return object
}

function symbolconverter (key, value) {
  if ((typeof (value) === 'object') || (typeof (value) === 'undefined')) {
    console.log(value)
  } else if ((value === "'null'") || (value === "'null'")) {
    value = null
  } else if ((value.match('^[0-9]*$')) != null) {
    value = parseInt(value)
  } else if ((value.match(/^[+-]?\d+(\.\d+)?$/) != null)) {
    value = parseFloat(value)
  }
  // TODO ADD all operators
  switch (key) {
    case '<and>':
      var symbol = {
        [Op.and]: value
      }
      break
    case '<ne>':
      var symbol = {
        [Op.ne]: value
      }
      break
    case '<notLike>':
      var symbol = {
        [Op.notLike]: value
      }
      break
    case '<is>':
      var symbol = {
        [Op.is]: value
      }
      break
    case '<not>':
      var symbol = {
        [Op.not]: value
      }
      break
    case '<startsWith>':
      var symbol = {
        [Op.startsWith]: value
      }
      break
    case '<gt>':
      var symbol = {
        [Op.gt]: value
      }
      break
    case '<lt>':
      var symbol = {
        [Op.lt]: value
      }
      break
    case '<or>':
      var symbol = {
        [Op.or]: value
      }
      break
    case '<eq>':
      var symbol = {
        [Op.eq]: value
      }
      break
    case '<like>':
      var symbol = {
        [Op.like]: value
      }
      break
    default:
      console.error('unknown sequelize operator: ' + key + '\n')
  }
  return symbol
}

function iterate (obj) {
  // kudos: https://stackoverflow.com/questions/15690706/recursively-looping-through-an-object-to-build-a-property-list/53620876#53620876
  const walked = []
  const stack = [{
    obj,
    stack: ''
  }]
  const result = []

  while (stack.length > 0) {
    const item = stack.pop()
    var obj = item.obj
    for (const property in obj) {
      // eslint-disable-next-line no-prototype-builtins
      if (obj.hasOwnProperty(property)) {
        if (typeof obj[property] === 'object') {
          let alreadyFound = false
          for (let i = 0; i < walked.length; i++) {
            if (walked[i] === obj[property]) {
              alreadyFound = true
              break
            }
          }
          if (!alreadyFound) {
            walked.push(obj[property])
            stack.push({
              obj: obj[property],
              stack: item.stack + '.' + property
            })
          }
        } else {
          console.log(item.stack + '.' + property + '=' + obj[property])
          result.push(item.stack + '.' + property + '=' + obj[property])
        }
      }
    }
  }
  return result
}

exports.symbolise = symbolise
// TEST CASES:
/*
  var symboloised = {"where":{"id":{[Op.gt]:10}}}
  var symboloised2={where: {[Op.or]: [{ id: 12 },{ id: 13 }]}}
  var symboloised3={
    where: {
    rank: {
      [Op.or]: {
        [Op.lt]: 1000,
        [Op.eq]: 'null'
      }
    }
      ,[Op.or]: [
        {
          title: {
            [Op.like]: 'Boat%'
          }
        },
        {
          description: {
            [Op.like]: '%boat%'
          }
        }
      ]
    }
  }

  var desymbolised= {"where":{"id":{"<gt>":10}}}
  var desymbolised2={where: {"<or>": [{ id: 12 },{ id: 13 }]}}
  var desymbolised3={
    where: {
      rank: {
        "<or>": {
          "<lt>": 1000,
          "<eq>": "null"
        }
      }
    ,"<or>": [
        {
          title: {
            "<like>": 'Boat%'
          }
        },
        {
          description: {
            "<like>": '%boat%'
          }
        }
      ]
    }
  }
  */
// console.log(symboloised2)
// console.log(desymbolised2)
// console.log(symboloised3)
// console.log(desymbolised3)

// Example1:
// .where.id.<gt>=10

// Example2:
// .where.<or>.1.id=13
// .where.<or>.0.id=12

// Example3:
// .where.<or>.1.description.<like>=%boat%
// .where.<or>.0.title.<like>=Boat%
// .where.rank.<or>.<lt>=1000
// .where.rank.<or>.<eq>=null

// var paths=[]
// paths.push(".where.id.<gt>=10") //1
// paths.push(".where.<or>.0.id=12") //2
// paths.push(".where.<or>.1.id=13") //2

// paths.push(".where.<or>.1.description.<like>=%boat%") //3
// paths.push(".where.<or>.0.title.<like>=Boat%") //3
// paths.push(".where.rank.<or>.<lt>=1000") //3
// paths.push(".where.rank.<or>.<eq>='null'") //3

// topic: https://stackoverflow.com/questions/37197067/access-javascript-json-object-properties-with-xpath-style

// alternatieves:
// https://github.com/JSONPath-Plus/JSONPath
// https://github.com/dchester/jsonpath

// https://stackoverflow.com/questions/51971642/how-to-add-new-node-to-json-using-jsonpath

// Symbols: https://wanago.io/2019/07/01/what-are-symbols-and-how-they-can-be-useful-to-you/
// desymbolise: https://stackoverflow.com/questions/56928520/javascript-object-with-symbol-key-gets-removed-by-stringify-also-cant-iterate
// https://medium.com/@tinderholmgene/querying-in-sequelize-47393badec01

// https://stackoverflow.com/questions/26106165/sequelize-dynamic-query-params
// https://stackoverflow.com/questions/45152582/javascript-object-with-symbol-property-gets-removed-by-stringify
