const ethers = require("ethers");
const dotenv = require("dotenv");
const redstone = require("redstone-api");
const constants = require("./constants");

dotenv.config();
const INFURA_PROJECT_ID = process.env.INFURA_PROJECT_ID;
const startPriceUSD = constants.startPriceUSD;

cryptoASymbol = "USDC";
cryptoBSymbol = "WETH";
const cryptoA = constants[cryptoASymbol];
const cryptoB = constants[cryptoBSymbol];

const provider = new ethers.providers.JsonRpcProvider(
  `https://mainnet.infura.io/v3/${INFURA_PROJECT_ID}`
);

const address = "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6"; // Uniswap V3 Quoter address
const abi = [
  "function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external returns (uint256 amountOut)",
];
const poolAbi = [
  "function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
];
const contract = new ethers.Contract(address, abi, provider);

async function getSecondCryptoPriceInFirstCrypto(fromCrypto, toCrypto) {
  const factoryAddress = "0x1F98431c8aD98523631AE4a59f267346ea31F984"; // Uniswap V3 Factory address
  const factoryAbi = [
    "function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)",
  ];
  const factoryContract = new ethers.Contract(
    factoryAddress,
    factoryAbi,
    provider
  );
  const poolAddress = await factoryContract.getPool(
    fromCrypto.address,
    toCrypto.address,
    3000 // 0.3% fee
  );
  const poolContract = new ethers.Contract(poolAddress, poolAbi, provider);
  const poolBalance = await poolContract.slot0();
  const sqrtPriceX96 = poolBalance.sqrtPriceX96;
  let Decimal0 = fromCrypto.decimals;
  let Decimal1 = toCrypto.decimals;
  if (fromCrypto.address.toLowerCase() > toCrypto.address.toLowerCase())
    [Decimal0, Decimal1] = [Decimal1, Decimal0];
  const buyOneOfToken0 =
    (sqrtPriceX96 / 2 ** 96) ** 2 /
    (10 ** Decimal1 / 10 ** Decimal0).toFixed(Decimal1);
  const buyOneOfToken1 = (1 / buyOneOfToken0).toFixed(Decimal0);
  if (fromCrypto.address.toLowerCase() > toCrypto.address.toLowerCase())
    return buyOneOfToken0;
  return buyOneOfToken1;
}

async function getOutAmount(fromAmount, fromCrypto, toCrypto) {
  const amountIn = ethers.utils.parseUnits(
    fromAmount.toString(),
    fromCrypto.decimals
  );
  const amountOut = await contract.callStatic.quoteExactInputSingle(
    fromCrypto.address,
    toCrypto.address,
    3000, // 0.3% fee
    amountIn,
    0
  );
  return ethers.utils.formatUnits(amountOut.toString(), toCrypto.decimals);
}

async function calculateSlippage(fromCrypto, toCrypto) {
  const secondPriceInFirst = await getSecondCryptoPriceInFirstCrypto(
    fromCrypto,
    toCrypto
  );
  console.log(
    `Price ${toCrypto.symbol} in ${fromCrypto.symbol}: ${secondPriceInFirst}`
  );
  const firstPriceInUSD = await redstone.getPrice(fromCrypto.symbol);
  let fromAmount = Number(startPriceUSD / firstPriceInUSD.value).toFixed(
    fromCrypto.decimals
  );
  let currentPrice = secondPriceInFirst;
  let receivedSecondAmount = 0;
  let expectedSecondAmount = 0;
  let jumps = 0;
  while (receivedSecondAmount * 2 >= expectedSecondAmount) {
    jumps++;
    receivedSecondAmount = await getOutAmount(fromAmount, fromCrypto, toCrypto);
    expectedSecondAmount = fromAmount / currentPrice;

    const differencePercentage = (
      ((receivedSecondAmount - expectedSecondAmount) / expectedSecondAmount) *
        100 +
      0.3
    ).toFixed(2); // 0.3 is gas fee
    const priceInUSD = (firstPriceInUSD.value * fromAmount).toFixed(2);
    console.log(
      `For ${fromAmount} ${fromCrypto.symbol} (${priceInUSD} USD), received ${toCrypto.symbol}: ${receivedSecondAmount}, expected ${toCrypto.symbol}: ${expectedSecondAmount}, difference: ${differencePercentage}%`
    );
    fromAmount *= 2;
  }
  console.log(
    `Jumps (the higher, the bigger pool, price harder to manipulate): ${jumps}`
  );
}

async function findSlippage() {
  await calculateSlippage(cryptoA, cryptoB);
  await calculateSlippage(cryptoB, cryptoA);
}

findSlippage().catch((err) => {
  console.error("Error occurred:", err);
});