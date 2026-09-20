// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Exact identity of the reviewed disposable canary deployed in this release.
/// Deployment creation inputs and runtime provenance are recorded in the receipt report.
library VerifiedCanaryV2 {
    bytes32 internal constant BUILD = 0xe7388911d0a7cb3c1fef4b8555d060a05782b7ada1dd18e5494ba3857bbc9138;

    function verify(address factory) internal view {
        require(factory == address(bytes20(hex"531b632463050e55db60f0025085ffbb2326ff64")), "unreviewed canary factory");
        require(
            address(bytes20(hex"6f06b2e4b34319a8b170e94213306e8d3c7d31b0")).codehash
                == 0x0fe34bbf5b7e775d85ce6d61cc07749231989f45d7fda2b5c59847fa95d468e0,
            "canary runtime mismatch"
        );
        require(
            address(bytes20(hex"8f1214295644c157256a974f839cfbcdd675cd76")).codehash
                == 0xf0296ed9f2c401d58126cfcfabd9d3b8d192bb8ba0889aaaf69a61d45176d9a0,
            "canary runtime mismatch"
        );
        require(
            address(bytes20(hex"36b38f3ccec71549faf2db11d653402b0ba7af7c")).codehash
                == 0xf83770df12868a5dca4ee45c78a906dcf7949f49faecb06a3debc560855021d2,
            "canary runtime mismatch"
        );
        require(
            address(bytes20(hex"532c940d39c9b2196f940085caede054af1004f0")).codehash
                == 0xe50c30b68e34cdd89d7f6110f6652918093f04580630bb6d5de1069c8e4afb2e,
            "canary runtime mismatch"
        );
        require(
            address(bytes20(hex"0b553a4d77a30ed1f638c0a5a7d58998c2fb0a4c")).codehash
                == 0x9f6f756e9469e979a03eb5e129a56d79f244d5557130a415de6f77d97157a62e,
            "canary runtime mismatch"
        );
        require(
            address(bytes20(hex"8a99b6b04ec414810da989b40b407c064fe48036")).codehash
                == 0x115dbedf486502a35bd243e558df287baa06975debe4e2728eb1059fef98c3ff,
            "canary runtime mismatch"
        );
        require(
            address(bytes20(hex"2b1690b6e32ae2684ce897174e5bab31be5dd8d8")).codehash
                == 0x5459e74ff2158d3fbb916b639519144d5f39b096b1c47265b1721f0d367d9de3,
            "canary runtime mismatch"
        );
        require(
            address(bytes20(hex"d1a3f2f4b25beb01ec7f8a858ed5d9532fc356cc")).codehash
                == 0xec6f4028bc67d1928c05baf155303670fc204db9288454442c7fe17c06b7f013,
            "canary runtime mismatch"
        );
        require(
            address(bytes20(hex"c9dd72066e008ccc937119a2c3c1d616d8deae5e")).codehash
                == 0x813307f58453dd7818faf3d2940ac91c37fcbe7baf580fde8c109153b5aaf24d,
            "canary runtime mismatch"
        );
        require(
            address(bytes20(hex"b8935987212de4bc5e076efe87a895b4ad8ce509")).codehash
                == 0x054a7312ae4743ea7ec83b5425095b14c9689435d9343a108b0b6ddcec4ec199,
            "canary runtime mismatch"
        );
        require(
            address(bytes20(hex"36c0237edea9dff90dce5491acaa2a7bec7fac0a")).codehash
                == 0x25244ceed54f586e48a821d008de4e7bf2aa956b331b2ad70bdbbffff10d8998,
            "canary runtime mismatch"
        );
        require(
            address(bytes20(hex"e046e5d14a50c63817f133108e1227318d9e52c4")).codehash
                == 0xfbbe40ca520e0264158fcb5ebfd69324d6ab7578eb75ad74ec44d21f9c8c55fe,
            "canary runtime mismatch"
        );
        require(
            address(bytes20(hex"8978cac534718aac8362b931581e8822915a0d40")).codehash
                == 0xa6241936b01ebe7eb148744da9549c2761ae380f78c5be20ef0ffceacda92f3b,
            "canary runtime mismatch"
        );
        require(
            address(bytes20(hex"ea836d96755eba2cf20e0d1da9c58016402c7f57")).codehash
                == 0x67d4ce2faff7dcf80207c2671eedebd8aed004fbf1edadae7fd91279ba9890c7,
            "canary runtime mismatch"
        );
        require(
            address(bytes20(hex"0265da353aece8418d2c592b10350bc0283ea63d")).codehash
                == 0x219d511462d0981fac4b223f9fefc11590303a05dabbf88deffd53c5f142b882,
            "canary runtime mismatch"
        );
        require(
            address(bytes20(hex"d15c0d2b88fe0dc04a939f6ce1eed157ed8778d3")).codehash
                == 0xd589e992577e0d17eda3b4a32f789b8c6c89aec7400078e42e80b4430b4ded6b,
            "canary runtime mismatch"
        );
        require(
            address(bytes20(hex"521de3e44a30ab4b3497cd7c498d90103c4253a0")).codehash
                == 0xac8c23f1358269a52c50e1cb9828fcf3fbdfcdcb9705fd7ced7976a06fa78858,
            "canary runtime mismatch"
        );
        require(
            address(bytes20(hex"72bdc139cd21e03fca7cfb9f5dd463e6efbeeaf5")).codehash
                == 0xb3f47c8b501d89239425e3232c9a849d59a4b2b6170ba95aea009be1485a3cdf,
            "canary runtime mismatch"
        );
        require(
            address(bytes20(hex"531b632463050e55db60f0025085ffbb2326ff64")).codehash
                == 0x31f039d741155fcd087fef4a30411eadcda2f37e6363eda919458215ba5e07ea,
            "canary runtime mismatch"
        );
    }
}
