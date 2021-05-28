
//const { waitForMined, expectThrow, increaseTime, mineBlock } = require('kleros-interaction/helpers/utils.js')
const MintableToken = artifacts.require('openzeppelin-solidity/contracts/token/ERC20/ERC20Mintable.sol')
const IICO = artifacts.require('IICO.sol')
const BN = require('bignumber.js')

const should = require('chai')
  .should();

async function expectThrow (promise, message) {
  try {
    await promise;
  } catch (error) {
    // Message is an optional parameter here
    if (message) {
      error.message.should.include(message, 'Expected \'' + message + '\', got \'' + error + '\' instead');
      return;
    } else {
      // TODO: Check jump destination to destinguish between a throw
      //       and an actual invalid jump.
      // TODO: When we contract A calls contract B, and B throws, instead
      //       of an 'invalid jump', we get an 'out of gas' error. How do
      //       we distinguish this from an actual out of gas event? (The
      //       ganache log actually show an 'invalid jump' event.)
      error.message.should.match(/[invalid opcode|out of gas|revert]/, 'Expected throw, got \'' + error + '\' instead');
      return;
    }
  }
  should.fail('Expected throw not received');
}

increaseTime = (time) => {
    return new Promise((resolve, reject) => {
        web3.currentProvider.sendAsync({
            jsonrpc: "2.0",
            method: "evm_increaseTime",
            params: [time],
            id: new Date().getTime()
        }, (err, result) => {
            if (err) { return reject(err); }
            return resolve(result);
        });
    });
}

contract('IICO', function (accounts) {
  let owner = accounts[0]
  let beneficiary = accounts[1]
  let buyerA = accounts[2]
  let buyerB = accounts[3]
  let buyerC = accounts[4]

  let timeBeforeStart = 1000
  let fullBonusLength = 5000
  let partialWithdrawalLength = 2500
  let withdrawalLockUpLength = 2500
  let maxBonus = 2E8
  let noCap = 120000000E18 // for placing bids with no cap
//  let minValuation = web3.toWei(1000, 'ether')
  let minValuation = 0
  let maxValuation = web3.toWei(100000, 'ether')
  let increment = web3.toWei(0.5, 'ether') 
  let numBuckets = 200001
  let tx, log
  let pokeReward = 0.01E18

  // Constructor
  it('Should create the contract with the initial setup', async () => {
    let startTestTime = web3.eth.getBlock('latest').timestamp
    let iico = await IICO.new(startTestTime+timeBeforeStart,fullBonusLength,partialWithdrawalLength, withdrawalLockUpLength,maxBonus,beneficiary, minValuation, maxValuation, increment, {from: owner})
    let minBucket = await iico.buckets(0)
    let maxBucket = await iico.buckets(numBuckets-1)

    assert.equal(await iico.owner(), owner, 'The owner is not set correctly')
    assert.equal(await iico.beneficiary(), beneficiary, 'The beneficiary is not set correctly')
    assert.equal(await iico.lastBidID(), 0, 'The lastBidID is not set correctly')
    assert.equal(await iico.startTime(), startTestTime+1000, 'The startTime is not set correctly')
    assert.equal(await iico.endFullBonusTime(), startTestTime+6000, 'The endFullBonusTime is not set correctly')
    assert.equal(await iico.withdrawalLockTime(), startTestTime+8500, 'The endFullBonusTime is not set correctly')
    assert.equal(await iico.endTime(), startTestTime+11000, 'The endFullBonusTime is not set correctly')
    assert.equal(await iico.maxBonus(), 2E8, 'The maxBonus is not set correctly')
    assert.equal(await iico.finalized(), false, 'The finalized is not set correctly')

    /* TODO: Do we need to track the cutoffbid in this case? */

    assert.equal(await iico.sumAcceptedContrib(), 0, 'The sumAcceptedContrib is not set correctly')
    assert.equal(await iico.sumAcceptedVirtualContrib(), 0, 'The sumAcceptedVirtualContrib is not set correctly')

    })

  // setToken
  it('Should set the token', async () => {
    let startTestTime = web3.eth.getBlock('latest').timestamp
    let iico = await IICO.new(startTestTime+timeBeforeStart,fullBonusLength,partialWithdrawalLength, withdrawalLockUpLength,maxBonus,beneficiary, minValuation, maxValuation, increment, {from: owner})
    let token = await MintableToken.new({from: owner})
    await token.mint(iico.address,160E24,{from: owner})
    await expectThrow(iico.setToken(token.address,{from: buyerA})) // Only owner can set.
    await iico.setToken(token.address,{from: owner})

    assert.equal(await iico.token(), token.address, 'The token is not set correctly')
    assert.equal(await iico.tokensForSale(), 160E24, 'The tokensForSale is not set correctly')
  })

  it('Should submit a bid with default valuations', async () => {
    let startTestTime = web3.eth.getBlock('latest').timestamp
    let iico = await IICO.new(startTestTime+timeBeforeStart,fullBonusLength,partialWithdrawalLength, withdrawalLockUpLength,maxBonus,beneficiary, minValuation, maxValuation, increment, {from: owner})
    let token = await MintableToken.new({from: owner})
    let minBucket = iico.buckets(0)
  
    await token.mint(iico.address,160E24,{from: owner})
    await iico.setToken(token.address,{from: owner})

    await expectThrow( iico.submitBid(maxValuation, 0, {from: buyerA, value:2E18}) )  

    increaseTime(1010)

    tx = await iico.submitBid(maxValuation, 0, {from: buyerA, value:2E18})
  
    log = tx.logs.find(log => log.event === 'BidSubmitted')
    assert.equal(log.args.contributor, buyerA)
    assert.equal(log.args.bidID, 1)
    

    let bid = await iico.bids.call(1)
    assert.equal(bid[0].toNumber(), maxValuation)
    assert.equal(bid[1], 0)
    assert.equal(bid[2].toNumber(), 2E18 - (2*pokeReward))
    assert.equal(bid[4], buyerA)
    assert.equal(bid[5], false)
    assert.equal(bid[6], false)
    assert.equal(bid[7], true)
    assert.equal(bid[8].toNumber(), 0)
    assert.equal(bid[9].toNumber(), numBuckets-1)
    
    // Check poke rewards are set
    assert.equal(bid[11].toNumber(), pokeReward)
    assert.equal(bid[12].toNumber(), pokeReward)
  })

  it('Should mark the bid inactive at submission.', async () => {
    let startTestTime = web3.eth.getBlock('latest').timestamp
    let iico = await IICO.new(startTestTime+timeBeforeStart,fullBonusLength,partialWithdrawalLength, withdrawalLockUpLength,maxBonus,beneficiary, minValuation, maxValuation, increment, {from: owner})
    let token = await MintableToken.new({from: owner})
    increaseTime(1010)

		await iico.submitBid(web3.toWei(1, 'ether'), 0, {from: buyerA, value:web3.toWei(2, 'ether')})

		let bid = await iico.bids.call(1)
		assert.equal(bid[7], false)

    let valuation = await iico.sumAcceptedContrib.call()
    assert.equal(valuation.toNumber(), 0)

		await iico.submitBid(web3.toWei(100, 'ether'), web3.toWei(50, 'ether'), {from: buyerB, value: web3.toWei(1, 'ether')})

		bid = await iico.bids.call(2)
		assert.equal(bid[4], buyerB)
		assert.equal(bid[7], false)

  })

  it('Should submit a bit and create a new bucket', async () => {
    let startTestTime = web3.eth.getBlock('latest').timestamp
    let iico = await IICO.new(startTestTime+timeBeforeStart,fullBonusLength,partialWithdrawalLength, withdrawalLockUpLength,maxBonus,beneficiary, minValuation, maxValuation, increment, {from: owner})
    let token = await MintableToken.new({from: owner})
   
		increaseTime(1010)

		await iico.submitBid(web3.toWei(1, 'ether'), 0, {from: buyerA, value:web3.toWei(2, 'ether')})
		
		let bid = await iico.bids(1)
		assert.equal(bid[8].toNumber(), 0)
		assert.equal(bid[9].toNumber(), 2)
		assert.equal(bid[7].false)
		
  })


  it ('Maximum cap should be accepted', async () => {
    let startTestTime = web3.eth.getBlock('latest').timestamp
    let iico = await IICO.new(startTestTime+timeBeforeStart,fullBonusLength,partialWithdrawalLength, withdrawalLockUpLength,maxBonus,beneficiary, minValuation, maxValuation, increment, {from: owner})
    let token = await MintableToken.new({from: owner})
	
    increaseTime(1010)	

    let maxmaxcap = BN('2^256 - 1')
    // inactive bid
    await iico.submitBid(web3.toWei(5, 'ether'), web3.toWei(3, 'ether'), {from: buyerA, value:web3.toWei(2, 'ether')})
    
  })

  it ('Inactive bid should be poked in', async () => {
    let startTestTime = web3.eth.getBlock('latest').timestamp
    let iico = await IICO.new(startTestTime+timeBeforeStart,fullBonusLength,partialWithdrawalLength, withdrawalLockUpLength,maxBonus,beneficiary, minValuation, maxValuation, increment, {from: owner})
    let token = await MintableToken.new({from: owner})
	
    increaseTime(1010)	

    // inactive bid
    await iico.submitBid(web3.toWei(5, 'ether'), web3.toWei(3, 'ether'), {from: buyerA, value:web3.toWei(2 + 0.02, 'ether')})
    
    let bid = await iico.bids.call(1)
    assert.equal(bid[7], false)
   
   	await iico.submitBid(maxValuation, 0, {from: buyerB, value: web3.toWei(1 + 0.02, 'ether')})
	  bid = await iico.bids.call(2)
	  assert.equal(bid[7], true)

    oldvaluation = await iico.sumAcceptedContrib()

    // Save buyerC current balance
    old_balance = await web3.eth.getBalance(buyerC)

    tx = await iico.pokeIn([1], {from: buyerC})
    console.log(tx.receipt.cumulativeGasUsed, web3.eth.gasPrice * tx.receipt.cumulativeGasUsed)
    log = tx.logs.find(log => log.event == 'PokeIn')
    assert.equal(log.args.poker, buyerC)
    assert.equal(log.args.bidID, 1)

    // Check the poke reward was distributed
    new_balance = await web3.eth.getBalance(buyerC)
    gasprice = await web3.eth.gasPrice.toNumber()
    assert(old_balance >= (new_balance - pokeReward))
    gasprice = await web3.eth.gasPrice

    // Check sale valuation
    newvaluation = await iico.sumAcceptedContrib()
    assert.equal(newvaluation - oldvaluation, 2E18)
  })

  it ('Estimate bad gas.', async () => {
    let startTestTime = web3.eth.getBlock('latest').timestamp
    let iico = await IICO.new(startTestTime+timeBeforeStart,fullBonusLength,partialWithdrawalLength, withdrawalLockUpLength,maxBonus,beneficiary, minValuation, maxValuation, increment, {from: owner})
    let token = await MintableToken.new({from: owner})
	
    increaseTime(1010)	
    
    let gas_amount = await iico.submitBid.estimateGas(web3.toWei(10, 'ether'), web3.toWei(1, 'ether'), {from: buyerA, value:web3.toWei(5 + 0.02, 'ether')})

    console.log('gas', gas_amount)
     
  })
    

  it ('Active bid should be poked out', async () => {
    let startTestTime = web3.eth.getBlock('latest').timestamp
    let iico = await IICO.new(startTestTime+timeBeforeStart,fullBonusLength,partialWithdrawalLength, withdrawalLockUpLength,maxBonus,beneficiary, minValuation, maxValuation, increment, {from: owner})
    let token = await MintableToken.new({from: owner})
	
    increaseTime(1010)	

    // inactive bid
    await iico.submitBid(web3.toWei(5, 'ether'), web3.toWei(0, 'ether'), {from: buyerA, value:web3.toWei(2 + 0.02, 'ether')})
    
    let bid = await iico.bids.call(1)
    assert.equal(bid[7], true)
   
   	await iico.submitBid(maxValuation, 0, {from: buyerB, value: web3.toWei(5 + 0.02, 'ether')})
	  bid = await iico.bids.call(2)
	  assert.equal(bid[7], true)

    oldvaluation = await iico.sumAcceptedContrib()

    // Save buyerC current balance
    old_balance = await web3.eth.getBalance(buyerC)

    tx = await iico.pokeOut([1], {from: buyerC})
    log = tx.logs.find(log => log.event == 'PokeOut')
    assert.equal(log.args.poker, buyerC)
    assert.equal(log.args.bidID, 1)

    // Check the poke reward was distributed
    new_balance = await web3.eth.getBalance(buyerC)
    gasprice = await web3.eth.gasPrice.toNumber()
    assert(new_balance > old_balance)

    // Check sale valuation
    newvaluation = await iico.sumAcceptedContrib()
    assert.equal(oldvaluation - newvaluation, 2E18)
  })
    
//  it ('Inactive bid should be poked in', async () => {
//    let startTestTime = web3.eth.getBlock('latest').timestamp
//    let iico = await IICO.new(startTestTime+timeBeforeStart,fullBonusLength,partialWithdrawalLength, withdrawalLockUpLength,maxBonus,beneficiary, minValuation, maxValuation, increment, {from: owner})
//    let token = await MintableToken.new({from: owner})
//	
//    increaseTime(1010)	
//
//    // inactive bid
//    await iico.submitBid(web3.toWei(5, 'ether'), web3.toWei(3, 'ether'), {from: buyerA, value:web3.toWei(2, 'ether')})
//    
//    let bid = await iico.bids.call(1)
//    assert.equal(bid[7], false)
//   
//   	await iico.submitBid(maxValuation, 0, {from: buyerB, value: web3.toWei(1, 'ether')})
//	  bid = await iico.bids.call(2)
//	  assert.equal(bid[7], true)
//
//	  tx = await iico.poke(1, {from: buyerC})
//    log = tx.logs.find(log => log.event === 'Poked')
//    assert.equal(log.args.poker, buyerC)
//    assert.equal(log.args.bidID, 1)
//
//	  bid = await iico.bids.call(1)
//	  assert.equal(bid[7], true)
//
//  })

//  it ('Active bid should be poked out', async () => {
//    let startTestTime = web3.eth.getBlock('latest').timestamp
//    let iico = await IICO.new(startTestTime+timeBeforeStart,fullBonusLength,partialWithdrawalLength, withdrawalLockUpLength,maxBonus,beneficiary, minValuation, maxValuation, increment, {from: owner})
//    let token = await MintableToken.new({from: owner})
//	
//    increaseTime(1010)	
//
//    // active bid
//    await iico.submitBid(web3.toWei(5, 'ether'), web3.toWei(3, 'ether'), {from: buyerA, value:web3.toWei(5, 'ether')})
//    
//    let bid = await iico.bids.call(1)
//    assert.equal(bid[7], true)
//   
//   	await iico.submitBid(maxValuation, 0, {from: buyerB, value: web3.toWei(1, 'ether')})
//	  bid = await iico.bids.call(2)
//	  assert.equal(bid[7], true)
//
//	  tx = await iico.poke(1, {from: buyerC})
//    log = tx.logs.find(log => log.event === 'Poked')
//    assert.equal(log.args.poker, buyerC)
//    assert.equal(log.args.bidID, 1)
//
//	  bid = await iico.bids.call(1)
//	  assert.equal(bid[7], false)
//
//  })

  it('Withdraw full amount before full bonus refund deadline', async () => {
    let startTestTime = web3.eth.getBlock('latest').timestamp
    let iico = await IICO.new(startTestTime+timeBeforeStart,fullBonusLength,partialWithdrawalLength, withdrawalLockUpLength,maxBonus,beneficiary, minValuation, maxValuation, increment, {from: owner})
    let token = await MintableToken.new({from: owner})

		increaseTime(1010)
    
   	await iico.submitBid(maxValuation, 0, {from: buyerB, value: web3.toWei(1, 'ether')})
	  let bid = await iico.bids.call(1)
	  assert.equal(bid[7], true)
    
    await iico.submitBid(maxValuation, 0, {from: buyerA, value: web3.toWei(5, 'ether')})
    bid = await iico.bids.call(2)
    assert.equal(bid[7], true)

    increaseTime(1000)
    await iico.withdraw(1, {from: buyerB})
    bid = await iico.bids.call(1)
    assert.equal(bid[5], true)

    let valuation = await iico.sumAcceptedContrib()
    assert.equal(valuation.toNumber(10), web3.toWei(5, 'ether'))

  })
  
//  it('Withdraw partial bid', async () => {
//    let startTestTime = web3.eth.getBlock('latest').timestamp
//    let iico = await IICO.new(startTestTime+timeBeforeStart,fullBonusLength,partialWithdrawalLength, withdrawalLockUpLength,maxBonus,beneficiary, minValuation, maxValuation, increment, {from: owner})
//    let token = await MintableToken.new({from: owner})
//
//		increaseTime(1010)
//    
//   	await iico.submitBid(maxValuation, 0, {from: buyerB, value: web3.toWei(1, 'ether')})
//	  let bid = await iico.bids.call(1)
//	  assert.equal(bid[7], true)
//    
//    await iico.submitBid(maxValuation, 0, {from: buyerA, value: web3.toWei(5, 'ether')})
//    bid = await iico.bids.call(2)
//    assert.equal(bid[7], true)
//
//    increaseTime(5000)
//    await iico.withdraw(1, {from: buyerB})
//    bid = await iico.bids.call(1)
//    assert.equal(bid[5], true)
//
//    let valuation = await iico.sumAcceptedContrib()
//    assert.equal(valuation.toNumber(10), web3.toWei(5, 'ether'))
//
//  })

//  it('Should get all the bid uints.', async () => {
//    let startTestTime = web3.eth.getBlock('latest').timestamp
//    let iico = await IICO.new(startTestTime+timeBeforeStart,fullBonusLength,partialWithdrawalLength, withdrawalLockUpLength,maxBonus,beneficiary, minValuation, maxValuation, increment, {from: owner})
//    let token = await MintableToken.new({from: owner})
//   
//		increaseTime(1010)
//  
//    let startNumber = web3.eth.blockNumber
//
//    for (let i = 0; i < 1000; i++) {
//		  let t = await iico.submitBid(web3.toWei(10000, 'ether'), 0, {from: buyerA, value:1})
//    }
//
//    assert.equal(startNumber+1001, await web3.eth.blockNumber)
//    let expectedNumber = startNumber + 1000
//    
//
//    let result = await iico.bidBufferUint.call()  
//    console.log(result)
//
//  })

})


    
