// Libraries
const BigNumber = require('bignumber.js')

// Contract artifacts
const DInterest = artifacts.require('DInterest')
const FeeModel = artifacts.require('FeeModel')
const AaveMarket = artifacts.require('AaveMarket')
const CompoundERC20Market = artifacts.require('CompoundERC20Market')
const NFT = artifacts.require('NFT')
const ICERC20 = artifacts.require('ICERC20')
const IComptroller = artifacts.require('IComptroller')
const ERC20 = artifacts.require('ERC20')
const ILendingPoolAddressesProvider = artifacts.require('ILendingPoolAddressesProvider')

// Mainnet contract addresses
const DAI_FUNDER_ADDR = "0x9eb7f2591ed42dee9315b6e2aaf21ba85ea69f8c"
const DAI_ADDR = "0x6b175474e89094c44da98b954eedeac495271d0f"
const CDAI_ADDR = "0x5d3a536E4D6DbD6114cc1Ead35777bAB948E3643"
const COMPTROLLER_ADDR = "0x3d9819210a31b4961b30ef54be2aed79b9c9cd3b"
const LENDING_POOL_ADDR_PROVIDER_ADDR = "0x24a42fD28C976A61Df5D00D0599C34c4f90748c8"

// Constants
const PRECISION = 1e18
const UIRMultiplier = BigNumber(0.75 * 1e18).integerValue().toFixed() // Minimum safe avg interest rate multiplier
const MinDepositPeriod = 90 * 24 * 60 * 60 // 90 days in seconds
const MaxDepositAmount = BigNumber(1000 * PRECISION).toFixed() // 1000 stablecoins
const YEAR_IN_SEC = 31556952 // Number of seconds in a year
const epsilon = 1e-6
const INF = BigNumber(2).pow(256).minus(1).toFixed()

// Utilities
// travel `time` seconds forward in time
function timeTravel (time) {
  return new Promise((resolve, reject) => {
    web3.currentProvider.send({
      jsonrpc: '2.0',
      method: 'evm_increaseTime',
      params: [time],
      id: new Date().getTime()
    }, (err, result) => {
      if (err) { return reject(err) }
      return resolve(result)
    })
  })
}

async function latestBlockTimestamp () {
  return (await web3.eth.getBlock('latest')).timestamp
}

function calcFeeAmount (interestAmount) {
  return interestAmount * 0.1
}

function calcUpfrontInterestAmount (depositAmount, interestRatePerSecond, depositPeriodInSeconds) {
  const ONE = BigNumber(1)
  const interestBeforeFee = BigNumber(depositAmount).times(ONE.minus(ONE.div(ONE.plus(BigNumber(interestRatePerSecond).times(depositPeriodInSeconds).div(PRECISION).times(UIRMultiplier).div(PRECISION)))))
  return interestBeforeFee.minus(calcFeeAmount(interestBeforeFee))
}

// Converts a JS number into a string that doesn't use scientific notation
function num2str (num) {
  return BigNumber(num).integerValue().toFixed()
}

function epsilonEq (curr, prev) {
  return BigNumber(curr).eq(prev) || BigNumber(curr).minus(prev).div(prev).abs().lt(epsilon)
}

// Tests
contract('DInterest: Compound', accounts => {
  // Accounts
  const acc0 = accounts[0]
  const acc1 = accounts[1]
  const acc2 = accounts[2]

  // Contract instances
  let stablecoin
  let cToken
  let dInterestPool
  let market
  let comptroller
  let comp
  let feeModel
  let depositNFT
  let fundingNFT

  beforeEach(async function () {
    // Initialize stablecoin and cToken
    stablecoin = await ERC20.at(DAI_ADDR)
    cToken = await ICERC20.at(CDAI_ADDR)

    // Mint stablecoin
    const mintAmount = 1000 * PRECISION
    // Send 0.1 eth to DAI_FUNDER_ADDR to have gas to send an ERC20 tx.
    await web3.eth.sendTransaction({
      from: accounts[0],
      to: DAI_FUNDER_ADDR,
      value: num2str(0.1 * PRECISION)
    });
    await stablecoin.transfer(acc0, num2str(mintAmount), { from: DAI_FUNDER_ADDR })
    await stablecoin.transfer(acc1, num2str(mintAmount), { from: DAI_FUNDER_ADDR })
    await stablecoin.transfer(acc2, num2str(mintAmount), { from: DAI_FUNDER_ADDR })

    // Initialize the money market
    feeModel = await FeeModel.new()
    market = await CompoundERC20Market.new(CDAI_ADDR, COMPTROLLER_ADDR, feeModel.address, stablecoin.address)

    // Initialize the NFTs
    depositNFT = await NFT.new('88mph Deposit', '88mph-Deposit')
    fundingNFT = await NFT.new('88mph Funding', '88mph-Funding')

    // Initialize the DInterest pool
    dInterestPool = await DInterest.new(UIRMultiplier, MinDepositPeriod, MaxDepositAmount, market.address, stablecoin.address, feeModel.address, depositNFT.address, fundingNFT.address)

    // Transfer the ownership of the money market to the DInterest pool
    await market.transferOwnership(dInterestPool.address)

    // Transfer NFT ownerships to the DInterest pool
    await depositNFT.transferOwnership(dInterestPool.address)
    await fundingNFT.transferOwnership(dInterestPool.address)
    console.log('test begins')
  })

  it('deposit()', async function () {
    const depositAmount = 100 * PRECISION

    // acc0 deposits stablecoin into the DInterest pool for 1 year
    await stablecoin.approve(dInterestPool.address, num2str(depositAmount), { from: acc0 })
    const blockNow = await latestBlockTimestamp()
    const acc0BeforeBalance = BigNumber(await stablecoin.balanceOf(acc0))
    await dInterestPool.deposit(num2str(depositAmount), num2str(blockNow + YEAR_IN_SEC), { from: acc0 })

    // Verify upfront interest amount
    /*const acc0CurrentBalance = BigNumber(await stablecoin.balanceOf(acc0))
    const blocktime = BigNumber(await dInterestPool.blocktime()).div(PRECISION)
    const interestRatePerSecond = BigNumber(INIT_INTEREST_RATE_PER_BLOCK).div(blocktime)
    const upfrontInterestExpected = calcUpfrontInterestAmount(depositAmount, interestRatePerSecond, num2str(YEAR_IN_SEC)).integerValue()
    const upfrontInterestActual = acc0CurrentBalance.minus(acc0BeforeBalance).plus(depositAmount)
    assert(epsilonEq(upfrontInterestExpected, upfrontInterestActual), 'acc0 didn\'t receive correct amount of upfront interest')*/

    // Verify totalDeposit
    const totalDeposit0 = BigNumber(await dInterestPool.totalDeposit())
    assert(totalDeposit0.eq(depositAmount), 'totalDeposit not updated after acc0 deposited')
  })

  it('withdraw()', async function () {
    const depositAmount = 10 * PRECISION

    // acc0 deposits stablecoin into the DInterest pool for 1 year
    await stablecoin.approve(dInterestPool.address, num2str(depositAmount), { from: acc0 })
    let blockNow = await latestBlockTimestamp()
    await dInterestPool.deposit(num2str(depositAmount), blockNow + YEAR_IN_SEC, { from: acc0 })

    // Wait 6 months
    await timeTravel(0.5 * YEAR_IN_SEC)

    // acc1 deposits stablecoin into the DInterest pool for 1 year
    await stablecoin.approve(dInterestPool.address, num2str(depositAmount), { from: acc1 })
    blockNow = await latestBlockTimestamp()
    await dInterestPool.deposit(num2str(depositAmount), blockNow + YEAR_IN_SEC, { from: acc1 })

    // Wait 6 months
    await timeTravel(0.5 * YEAR_IN_SEC)

    // acc0 withdraws
    const acc0BeforeBalance = await stablecoin.balanceOf(acc0)
    await dInterestPool.withdraw(1, 0, { from: acc0 })

    // try withdrawing again (should fail)
    try {
      await dInterestPool.withdraw(1, 0, { from: acc0 })
      assert.fail('acc0 withdrew twice')
    } catch (error) { }

    // Verify withdrawn amount
    const acc0CurrentBalance = await stablecoin.balanceOf(acc0)
    assert.equal(acc0CurrentBalance - acc0BeforeBalance, depositAmount, 'acc0 didn\'t withdraw correct amount of stablecoin')
    // Verify totalDeposit
    const totalDeposit0 = BigNumber(await dInterestPool.totalDeposit())
    assert(totalDeposit0.eq(depositAmount), 'totalDeposit not updated after acc0 withdrawed')

    // Wait 6 months
    await timeTravel(0.5 * YEAR_IN_SEC)

    // acc1 withdraws
    const acc1BeforeBalance = await stablecoin.balanceOf(acc1)
    await dInterestPool.withdraw(2, 0, { from: acc1 })

    // Verify withdrawn amount
    const acc1CurrentBalance = await stablecoin.balanceOf(acc1)
    assert.equal(acc1CurrentBalance - acc1BeforeBalance, depositAmount, 'acc1 didn\'t withdraw correct amount of stablecoin')
    // Verify totalDeposit
    const totalDeposit1 = BigNumber(await dInterestPool.totalDeposit())
    assert(totalDeposit1.eq(0), 'totalDeposit not updated after acc1 withdrawed')
  })

  it('earlyWithdraw()', async function () {
    const depositAmount = 10 * PRECISION

    // acc0 deposits stablecoin into the DInterest pool for 1 year
    await stablecoin.approve(dInterestPool.address, num2str(depositAmount), { from: acc0 })
    let blockNow = await latestBlockTimestamp()
    await dInterestPool.deposit(num2str(depositAmount), blockNow + YEAR_IN_SEC, { from: acc0 })

    // acc0 withdraws early
    const acc0BeforeBalance = BigNumber(await stablecoin.balanceOf(acc0))
    await dInterestPool.earlyWithdraw(1, 0, { from: acc0 })

    // Verify withdrawn amount
    const initialDeficit = BigNumber((await dInterestPool.getDeposit(1)).initialDeficit)
    const acc0CurrentBalance = BigNumber(await stablecoin.balanceOf(acc0))
    assert.equal(acc0CurrentBalance.minus(acc0BeforeBalance).toNumber(), BigNumber(depositAmount).minus(initialDeficit).toNumber(), 'acc0 didn\'t withdraw correct amount of stablecoin')
    // Verify totalDeposit
    const totalDeposit0 = BigNumber(await dInterestPool.totalDeposit())
    assert(totalDeposit0.eq(0), 'totalDeposit not updated after acc0 withdrawed')

    // acc0 deposits stablecoin into the DInterest pool for 1 year
    await stablecoin.approve(dInterestPool.address, num2str(depositAmount), { from: acc0 })
    blockNow = await latestBlockTimestamp()
    await dInterestPool.deposit(num2str(depositAmount), blockNow + YEAR_IN_SEC, { from: acc0 })

    // Wait 1 year
    await timeTravel(1 * YEAR_IN_SEC)

    // acc0 tries to withdraw early but fails
    try {
      await dInterestPool.earlyWithdraw(2, 0, { from: acc0 })
      assert.fail('Called earlyWithdraw() after maturation without error')
    } catch (e) { }
  })

  it('fundAll()', async function () {
    const depositAmount = 10 * PRECISION

    // acc0 deposits stablecoin into the DInterest pool for 1 year
    await stablecoin.approve(dInterestPool.address, num2str(depositAmount), { from: acc0 })
    let blockNow = await latestBlockTimestamp()
    await dInterestPool.deposit(num2str(depositAmount), blockNow + YEAR_IN_SEC, { from: acc0 })

    // acc1 deposits stablecoin into the DInterest pool for 1 year
    await stablecoin.approve(dInterestPool.address, num2str(depositAmount), { from: acc1 })
    blockNow = await latestBlockTimestamp()
    await dInterestPool.deposit(num2str(depositAmount), blockNow + YEAR_IN_SEC, { from: acc1 })

    // acc1 deposits stablecoin into the DInterest pool for 3 months
    await stablecoin.approve(dInterestPool.address, num2str(depositAmount), { from: acc1 })
    blockNow = await latestBlockTimestamp()
    await dInterestPool.deposit(num2str(depositAmount), blockNow + 0.25 * YEAR_IN_SEC, { from: acc1 })

    // Wait 3 months
    await timeTravel(0.25 * YEAR_IN_SEC)

    // Withdraw deposit 3
    await dInterestPool.withdraw(3, 0, { from: acc1 })

    // Fund all deficit using acc2
    await stablecoin.approve(dInterestPool.address, INF, { from: acc2 })
    await dInterestPool.fundAll({ from: acc2 })

    // Check deficit
    const surplusObj = await dInterestPool.surplus.call()
    assert(surplusObj.isNegative || (surplusObj.isNegative && epsilonEq(surplusObj.surplusAmount, 0)), 'Surplus negative after funding all deposits')

    // Wait 9 months
    await timeTravel(0.75 * YEAR_IN_SEC)

    // acc0, acc1 withdraw deposits
    const acc2BeforeBalance = BigNumber(await stablecoin.balanceOf(acc2))
    await dInterestPool.withdraw(1, 1, { from: acc0 })
    await dInterestPool.withdraw(2, 1, { from: acc1 })

    // Check interest earned by funder
    /*const acc2AfterBalance = BigNumber(await stablecoin.balanceOf(acc2))
    assert(epsilonEq(acc2AfterBalance.minus(acc2BeforeBalance), BigNumber(depositAmount).times(2).times(rateAfter1y.div(rateAfter3m).minus(1))), 'acc2 didn\'t receive correct interest amount')*/
  })

  it('fundMultiple()', async function () {
    const depositAmount = 10 * PRECISION

    // acc0 deposits stablecoin into the DInterest pool for 1 year
    await stablecoin.approve(dInterestPool.address, num2str(depositAmount), { from: acc0 })
    let blockNow = await latestBlockTimestamp()
    await dInterestPool.deposit(num2str(depositAmount), blockNow + YEAR_IN_SEC, { from: acc0 })

    // acc1 deposits stablecoin into the DInterest pool for 3 months
    await stablecoin.approve(dInterestPool.address, num2str(depositAmount), { from: acc1 })
    blockNow = await latestBlockTimestamp()
    await dInterestPool.deposit(num2str(depositAmount), blockNow + 0.25 * YEAR_IN_SEC, { from: acc1 })

    // acc1 deposits stablecoin into the DInterest pool for 1 year
    await stablecoin.approve(dInterestPool.address, num2str(depositAmount), { from: acc1 })
    blockNow = await latestBlockTimestamp()
    await dInterestPool.deposit(num2str(depositAmount), blockNow + YEAR_IN_SEC, { from: acc1 })

    // acc1 deposits stablecoin into the DInterest pool for 1 year
    await stablecoin.approve(dInterestPool.address, num2str(depositAmount), { from: acc1 })
    blockNow = await latestBlockTimestamp()
    await dInterestPool.deposit(num2str(depositAmount), blockNow + YEAR_IN_SEC, { from: acc1 })

    // Wait 3 months
    await timeTravel(0.25 * YEAR_IN_SEC)

    // Withdraw deposit 2
    await dInterestPool.withdraw(2, 0, { from: acc1 })

    // Fund deficit for the first 3 deposits using acc2
    await stablecoin.approve(dInterestPool.address, INF, { from: acc2 })
    await dInterestPool.fundMultiple(3, { from: acc2 })

    // Check deficit
    // Deficits of deposits 1-3 are filled, so the pool's deficit/surplus should equal that of deposit 4
    const deposit4SurplusObj = await dInterestPool.surplusOfDeposit.call(4)
    const expectedSurplus = BigNumber(deposit4SurplusObj.surplusAmount).times(deposit4SurplusObj.isNegative ? -1 : 1)
    const surplusObj = await dInterestPool.surplus.call()
    const actualSurplus = BigNumber(surplusObj.surplusAmount).times(surplusObj.isNegative ? -1 : 1)
    assert(epsilonEq(actualSurplus, expectedSurplus), 'Incorrect surplus after funding')

    // Wait 9 months
    await timeTravel(0.75 * YEAR_IN_SEC)

    // acc0, acc1 withdraw deposits
    const acc2BeforeBalance = BigNumber(await stablecoin.balanceOf(acc2))
    await dInterestPool.withdraw(1, 1, { from: acc0 })
    await dInterestPool.withdraw(3, 1, { from: acc1 })
    await dInterestPool.withdraw(4, 0, { from: acc1 })

    // Check interest earned by funder
    /*const acc2AfterBalance = BigNumber(await stablecoin.balanceOf(acc2))
    assert(epsilonEq(acc2AfterBalance.minus(acc2BeforeBalance), BigNumber(depositAmount).times(2).times(rateAfter1y.div(rateAfter3m).minus(1))), 'acc2 didn\'t receive correct interest amount')*/
  })

  it('claimComp()', async function () {
    const beneficiary = '0x332D87209f7c8296389C307eAe170c2440830A47'
    const expectedMintAmount = PRECISION
    const beforeBalance = await comp.balanceOf(beneficiary)
    await market.claimComp()
    //assert.equal(expectedMintAmount, BigNumber(await comp.balanceOf(beneficiary)).minus(beforeBalance).toNumber(), 'Claimed COMP amount incorrect')
  })
})

/*contract('DInterest: Aave', accounts => {
  // Accounts
  const acc0 = accounts[0]
  const acc1 = accounts[1]
  const acc2 = accounts[2]

  // Contract instances
  let stablecoin
  let aToken
  let lendingPoolCore
  let lendingPool
  let lendingPoolAddressesProvider
  let dInterestPool
  let market
  let feeModel

  // Constants
  const INIT_INTEREST_RATE = 0.1 // 10% APY

  beforeEach(async function () {
    // Initialize mock stablecoin and Aave
    stablecoin = await ERC20Mock.new()
    aToken = await ATokenMock.new(stablecoin.address)
    lendingPoolCore = await LendingPoolCoreMock.new()
    lendingPool = await LendingPoolMock.new(lendingPoolCore.address)
    await lendingPoolCore.setLendingPool(lendingPool.address)
    await lendingPool.setReserveAToken(stablecoin.address, aToken.address)
    lendingPoolAddressesProvider = await LendingPoolAddressesProviderMock.new()
    await lendingPoolAddressesProvider.setLendingPoolImpl(lendingPool.address)
    await lendingPoolAddressesProvider.setLendingPoolCoreImpl(lendingPoolCore.address)

    // Mint stablecoin
    const mintAmount = 1000 * PRECISION
    await stablecoin.mint(aToken.address, num2str(mintAmount))
    await stablecoin.mint(acc0, num2str(mintAmount))
    await stablecoin.mint(acc1, num2str(mintAmount))
    await stablecoin.mint(acc2, num2str(mintAmount))

    // Initialize the money market
    market = await AaveMarket.new(lendingPoolAddressesProvider.address, stablecoin.address)

    // Initialize the NFTs
    depositNFT = await NFT.new('88mph Deposit', '88mph-Deposit')
    fundingNFT = await NFT.new('88mph Funding', '88mph-Funding')

    // Initialize the DInterest pool
    feeModel = await FeeModel.new()
    dInterestPool = await DInterest.new(UIRMultiplier, MinDepositPeriod, MaxDepositAmount, market.address, stablecoin.address, feeModel.address, depositNFT.address, fundingNFT.address)

    // Transfer the ownership of the money market to the DInterest pool
    await market.transferOwnership(dInterestPool.address)

    // Transfer NFT ownerships to the DInterest pool
    await depositNFT.transferOwnership(dInterestPool.address)
    await fundingNFT.transferOwnership(dInterestPool.address)
  })

  it('deposit()', async function () {
    const depositAmount = 100 * PRECISION

    // acc0 deposits stablecoin into the DInterest pool for 1 year
    await stablecoin.approve(dInterestPool.address, num2str(depositAmount), { from: acc0 })
    const blockNow = await latestBlockTimestamp()
    const acc0BeforeBalance = BigNumber(await stablecoin.balanceOf(acc0))
    await dInterestPool.deposit(num2str(depositAmount), num2str(blockNow + YEAR_IN_SEC), { from: acc0 })

    // Verify upfront interest amount
    const acc0CurrentBalance = BigNumber(await stablecoin.balanceOf(acc0))
    const interestRatePerSecond = BigNumber(INIT_INTEREST_RATE).times(1e18).div(YEAR_IN_SEC)
    const upfrontInterestExpected = calcUpfrontInterestAmount(depositAmount, interestRatePerSecond, num2str(YEAR_IN_SEC)).integerValue()
    const upfrontInterestActual = acc0CurrentBalance.minus(acc0BeforeBalance).plus(depositAmount)
    // console.log(upfrontInterestExpected.div(depositAmount).toFixed())
    // console.log(upfrontInterestActual.div(depositAmount).toFixed())
    assert(epsilonEq(upfrontInterestExpected, upfrontInterestActual), 'acc0 didn\'t receive correct amount of upfront interest')

    // Verify totalDeposit
    const totalDeposit0 = BigNumber(await dInterestPool.totalDeposit())
    assert(totalDeposit0.eq(depositAmount), 'totalDeposit not updated after acc0 deposited')
  })

  it('withdraw()', async function () {
    const depositAmount = 10 * PRECISION

    // acc0 deposits stablecoin into the DInterest pool for 1 year
    await stablecoin.approve(dInterestPool.address, num2str(depositAmount), { from: acc0 })
    let blockNow = await latestBlockTimestamp()
    await dInterestPool.deposit(num2str(depositAmount), blockNow + YEAR_IN_SEC, { from: acc0 })

    // Wait 6 months
    await timeTravel(0.5 * YEAR_IN_SEC)
    await aToken.mintInterest(num2str(0.5 * YEAR_IN_SEC))

    // acc1 deposits stablecoin into the DInterest pool for 1 year
    await stablecoin.approve(dInterestPool.address, num2str(depositAmount), { from: acc1 })
    blockNow = await latestBlockTimestamp()
    await dInterestPool.deposit(num2str(depositAmount), blockNow + YEAR_IN_SEC, { from: acc1 })

    // Wait 6 months
    await timeTravel(0.5 * YEAR_IN_SEC)
    await aToken.mintInterest(num2str(0.5 * YEAR_IN_SEC))

    // acc0 withdraws
    const acc0BeforeBalance = await stablecoin.balanceOf(acc0)
    await dInterestPool.withdraw(1, 0, { from: acc0 })

    // try withdrawing again (should fail)
    try {
      await dInterestPool.withdraw(1, 0, { from: acc0 })
      assert.fail('acc0 withdrew twice')
    } catch (error) { }

    // Verify withdrawn amount
    const acc0CurrentBalance = await stablecoin.balanceOf(acc0)
    assert.equal(acc0CurrentBalance - acc0BeforeBalance, depositAmount, 'acc0 didn\'t withdraw correct amount of stablecoin')
    // Verify totalDeposit
    const totalDeposit0 = BigNumber(await dInterestPool.totalDeposit())
    assert(totalDeposit0.eq(depositAmount), 'totalDeposit not updated after acc0 withdrawed')

    // Wait 6 months
    await timeTravel(0.5 * YEAR_IN_SEC)
    await aToken.mintInterest(num2str(0.5 * YEAR_IN_SEC))

    // acc1 withdraws
    const acc1BeforeBalance = await stablecoin.balanceOf(acc1)
    await dInterestPool.withdraw(2, 0, { from: acc1 })

    // Verify withdrawn amount
    const acc1CurrentBalance = await stablecoin.balanceOf(acc1)
    assert.equal(acc1CurrentBalance - acc1BeforeBalance, depositAmount, 'acc1 didn\'t withdraw correct amount of stablecoin')
    // Verify totalDeposit
    const totalDeposit1 = BigNumber(await dInterestPool.totalDeposit())
    assert(totalDeposit1.eq(0), 'totalDeposit not updated after acc1 withdrawed')
  })

  it('earlyWithdraw()', async function () {
    const depositAmount = 10 * PRECISION

    // acc0 deposits stablecoin into the DInterest pool for 1 year
    await stablecoin.approve(dInterestPool.address, num2str(depositAmount), { from: acc0 })
    let blockNow = await latestBlockTimestamp()
    await dInterestPool.deposit(num2str(depositAmount), blockNow + YEAR_IN_SEC, { from: acc0 })

    // acc0 withdraws early
    const acc0BeforeBalance = BigNumber(await stablecoin.balanceOf(acc0))
    await dInterestPool.earlyWithdraw(1, 0, { from: acc0 })

    // Verify withdrawn amount
    const initialDeficit = BigNumber((await dInterestPool.getDeposit(1)).initialDeficit)
    const acc0CurrentBalance = BigNumber(await stablecoin.balanceOf(acc0))
    assert.equal(acc0CurrentBalance.minus(acc0BeforeBalance).toNumber(), BigNumber(depositAmount).minus(initialDeficit).toNumber(), 'acc0 didn\'t withdraw correct amount of stablecoin')
    // Verify totalDeposit
    const totalDeposit0 = BigNumber(await dInterestPool.totalDeposit())
    assert(totalDeposit0.eq(0), 'totalDeposit not updated after acc0 withdrawed')

    // acc0 deposits stablecoin into the DInterest pool for 1 year
    await stablecoin.approve(dInterestPool.address, num2str(depositAmount), { from: acc0 })
    blockNow = await latestBlockTimestamp()
    await dInterestPool.deposit(num2str(depositAmount), blockNow + YEAR_IN_SEC, { from: acc0 })

    // Wait 1 year
    await timeTravel(1 * YEAR_IN_SEC)

    // acc0 tries to withdraw early but fails
    try {
      await dInterestPool.earlyWithdraw(2, 0, { from: acc0 })
      assert.fail('Called earlyWithdraw() after maturation without error')
    } catch (e) { }
  })

  it('fundAll()', async function () {
    const depositAmount = 10 * PRECISION

    // acc0 deposits stablecoin into the DInterest pool for 1 year
    await stablecoin.approve(dInterestPool.address, num2str(depositAmount), { from: acc0 })
    let blockNow = await latestBlockTimestamp()
    await dInterestPool.deposit(num2str(depositAmount), blockNow + YEAR_IN_SEC, { from: acc0 })

    // acc1 deposits stablecoin into the DInterest pool for 1 year
    await stablecoin.approve(dInterestPool.address, num2str(depositAmount), { from: acc1 })
    blockNow = await latestBlockTimestamp()
    await dInterestPool.deposit(num2str(depositAmount), blockNow + YEAR_IN_SEC, { from: acc1 })

    // acc1 deposits stablecoin into the DInterest pool for 3 months
    await stablecoin.approve(dInterestPool.address, num2str(depositAmount), { from: acc1 })
    blockNow = await latestBlockTimestamp()
    await dInterestPool.deposit(num2str(depositAmount), blockNow + 0.25 * YEAR_IN_SEC, { from: acc1 })

    // Wait 3 months
    await timeTravel(0.25 * YEAR_IN_SEC)
    await aToken.mintInterest(num2str(0.25 * YEAR_IN_SEC))

    // Withdraw deposit 3
    await dInterestPool.withdraw(3, 0, { from: acc1 })

    // Fund all deficit using acc2
    await stablecoin.approve(dInterestPool.address, INF, { from: acc2 })
    await dInterestPool.fundAll({ from: acc2 })

    // Check deficit
    const surplusObj = await dInterestPool.surplus.call()
    assert.equal(surplusObj.isNegative, false, 'Surplus negative after funding all deposits')

    // Wait 9 months
    await timeTravel(0.75 * YEAR_IN_SEC)
    await aToken.mintInterest(num2str(0.75 * YEAR_IN_SEC))

    // acc0, acc1 withdraw deposits
    const acc2BeforeBalance = BigNumber(await stablecoin.balanceOf(acc2))
    await dInterestPool.withdraw(1, 1, { from: acc0 })
    await dInterestPool.withdraw(2, 1, { from: acc1 })

    // Check interest earned by funder
    const acc2AfterBalance = BigNumber(await stablecoin.balanceOf(acc2))
    assert(epsilonEq(acc2AfterBalance.minus(acc2BeforeBalance), BigNumber(depositAmount).times(2).times(INIT_INTEREST_RATE).times(0.75)), 'acc2 didn\'t receive correct interest amount')
  })

  it('fundMultiple()', async function () {
    const depositAmount = 10 * PRECISION

    // acc0 deposits stablecoin into the DInterest pool for 1 year
    await stablecoin.approve(dInterestPool.address, num2str(depositAmount), { from: acc0 })
    let blockNow = await latestBlockTimestamp()
    await dInterestPool.deposit(num2str(depositAmount), blockNow + YEAR_IN_SEC, { from: acc0 })

    // acc1 deposits stablecoin into the DInterest pool for 3 months
    await stablecoin.approve(dInterestPool.address, num2str(depositAmount), { from: acc1 })
    blockNow = await latestBlockTimestamp()
    await dInterestPool.deposit(num2str(depositAmount), blockNow + 0.25 * YEAR_IN_SEC, { from: acc1 })

    // acc1 deposits stablecoin into the DInterest pool for 1 year
    await stablecoin.approve(dInterestPool.address, num2str(depositAmount), { from: acc1 })
    blockNow = await latestBlockTimestamp()
    await dInterestPool.deposit(num2str(depositAmount), blockNow + YEAR_IN_SEC, { from: acc1 })

    // acc1 deposits stablecoin into the DInterest pool for 1 year
    await stablecoin.approve(dInterestPool.address, num2str(depositAmount), { from: acc1 })
    blockNow = await latestBlockTimestamp()
    await dInterestPool.deposit(num2str(depositAmount), blockNow + YEAR_IN_SEC, { from: acc1 })

    // Wait 3 months
    await timeTravel(0.25 * YEAR_IN_SEC)
    await aToken.mintInterest(num2str(0.25 * YEAR_IN_SEC))

    // Withdraw deposit 2
    await dInterestPool.withdraw(2, 0, { from: acc1 })

    // Fund deficit for the first 3 deposits using acc2
    await stablecoin.approve(dInterestPool.address, INF, { from: acc2 })
    await dInterestPool.fundMultiple(3, { from: acc2 })

    // Check deficit
    // Deficits of deposits 1-3 are filled, so the pool's deficit/surplus should equal that of deposit 4
    const deposit4SurplusObj = await dInterestPool.surplusOfDeposit.call(4)
    const expectedSurplus = BigNumber(deposit4SurplusObj.surplusAmount).times(deposit4SurplusObj.isNegative ? -1 : 1)
    const surplusObj = await dInterestPool.surplus.call()
    const actualSurplus = BigNumber(surplusObj.surplusAmount).times(surplusObj.isNegative ? -1 : 1)
    assert(epsilonEq(actualSurplus, expectedSurplus), 'Incorrect surplus after funding')

    // Wait 9 months
    await timeTravel(0.75 * YEAR_IN_SEC)
    await aToken.mintInterest(num2str(0.75 * YEAR_IN_SEC))

    // acc0, acc1 withdraw deposits
    const acc2BeforeBalance = BigNumber(await stablecoin.balanceOf(acc2))
    await dInterestPool.withdraw(1, 1, { from: acc0 })
    await dInterestPool.withdraw(3, 1, { from: acc1 })
    await dInterestPool.withdraw(4, 0, { from: acc1 })

    // Check interest earned by funder
    const acc2AfterBalance = BigNumber(await stablecoin.balanceOf(acc2))
    assert(epsilonEq(acc2AfterBalance.minus(acc2BeforeBalance), BigNumber(depositAmount).times(2).times(INIT_INTEREST_RATE).times(0.75)), 'acc2 didn\'t receive correct interest amount')
  })
})*/