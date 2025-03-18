// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ICurvePool
 * @dev Interface for interacting with Curve stable swap pools
 */
interface ICurvePool {
    // View functions
    function get_virtual_price() external view returns (uint256);

    function coins(uint256 i) external view returns (address);

    function balances(uint256 i) external view returns (uint256);

    function get_dy(
        int128 i,
        int128 j,
        uint256 dx
    ) external view returns (uint256);

    function calc_token_amount(
        uint256[3] calldata amounts,
        bool is_deposit
    ) external view returns (uint256);

    // State-changing functions
    function add_liquidity(
        uint256[3] calldata amounts,
        uint256 min_mint_amount
    ) external returns (uint256);

    function remove_liquidity(
        uint256 _amount,
        uint256[3] calldata min_amounts
    ) external returns (uint256[3] memory);

    function remove_liquidity_one_coin(
        uint256 _token_amount,
        int128 i,
        uint256 min_amount
    ) external returns (uint256);

    function exchange(
        int128 i,
        int128 j,
        uint256 dx,
        uint256 min_dy
    ) external returns (uint256);

    // Fee related
    function fee() external view returns (uint256);

    function admin_fee() external view returns (uint256);
}
