pragma solidity 0.5.17;

import "@openzeppelin/contracts/ownership/Ownable.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "../libs/DecMath.sol";
import "./MPHToken.sol";

contract MPHMinter is Ownable {
    using Address for address;
    using DecMath for uint256;

    /**
        @notice The multiplier applied to the interest generated by a pool when minting MPH
     */
    mapping(address => uint256) poolMintingMultiplier;

    /**
        External contracts
     */
    MPHToken public mph;

    constructor(address _mph) public {
        mph = MPHToken(_mph);
    }

    function mintMPHForInterest(address to, uint256 interestAmount)
        external
        returns (bool)
    {
        uint256 multiplier = poolMintingMultiplier[msg.sender];
        if (multiplier == 0) {
            // sender is not a pool/has been deactivated
            return false;
        }

        uint256 mintAmount = interestAmount.decmul(multiplier);
        mph.mint(to, mintAmount);
        return true;
    }

    function setPoolMintingMultiplier(address pool, uint256 newMultiplier)
        external
        onlyOwner
    {
        require(pool.isContract(), "MPHMinter: pool not contract");
        poolMintingMultiplier[pool] = newMultiplier;
    }
}