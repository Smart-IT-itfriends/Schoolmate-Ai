const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testConfig = {
  referral: {
    referrerReward: 50,
    refereeReward: 25,
    maxReferralsPerDay: 2,
    maxReferralsTotal: 0,
  },
};

function withTempUsers(users, fn) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'referral-test-'));
  const usersFile = path.join(tempDir, 'users.json');
  fs.writeFileSync(usersFile, JSON.stringify(users, null, 2), 'utf8');
  const previous = process.env.USERS_FILE;
  process.env.USERS_FILE = usersFile;

  delete require.cache[require.resolve('../services/userService')];
  delete require.cache[require.resolve('../services/referralService')];

  const referralService = require('../services/referralService');
  const userService = require('../services/userService');

  try {
    return fn({ referralService, userService, usersFile });
  } finally {
    if (previous === undefined) {
      delete process.env.USERS_FILE;
    } else {
      process.env.USERS_FILE = previous;
    }
    delete require.cache[require.resolve('../services/userService')];
    delete require.cache[require.resolve('../services/referralService')];
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

test('parseStartPayload extracts referral code from deep link', () => {
  withTempUsers({}, ({ referralService }) => {
    assert.equal(referralService.parseStartPayload('/start ref_ABC123'), 'ABC123');
    assert.equal(referralService.parseStartPayload('/start'), null);
    assert.equal(referralService.parseStartPayload('/start other'), 'other');
  });
});

test('buildReferralLink formats telegram deep link', () => {
  withTempUsers({}, ({ referralService }) => {
    const link = referralService.buildReferralLink('SchoolmateBot', 'ABC123');
    assert.equal(link, 'https://t.me/SchoolmateBot?start=ref_ABC123');
  });
});

test('applyReferralCode rejects self-referral', () => {
  withTempUsers(
    {
      '111': {
        step: 'completed',
        telegramId: 111,
        referralCode: 'SELF01',
        xp: 0,
        referralsCount: 0,
        referredUsers: [],
      },
    },
    ({ referralService }) => {
      const refereeSession = { referredBy: null };
      const result = referralService.applyReferralCode(111, 'SELF01', refereeSession);
      assert.equal(result.valid, false);
      assert.equal(result.reason, 'self_referral');
    }
  );
});

test('processReferralReward awards XP to referrer and referee', () => {
  withTempUsers(
    {
      '100': {
        step: 'completed',
        telegramId: 100,
        name: 'Referrer',
        referralCode: 'REF100',
        xp: 10,
        referralsCount: 0,
        referredUsers: [],
        referralRewardsToday: 0,
        referralRewardsDate: null,
      },
      '200': {
        step: 'completed',
        telegramId: 200,
        name: 'Referee',
        xp: 0,
        referredBy: 100,
        referralRewardClaimed: false,
      },
    },
    ({ referralService, userService }) => {
      const result = referralService.processReferralReward(200, testConfig);
      assert.equal(result.success, true);
      assert.equal(result.referrerReward, 50);
      assert.equal(result.refereeReward, 25);

      const users = userService.loadUsers();
      assert.equal(users['100'].xp, 60);
      assert.equal(users['100'].referralsCount, 1);
      assert.equal(users['200'].xp, 25);
      assert.equal(users['200'].referralRewardClaimed, true);
    }
  );
});

test('processReferralReward prevents duplicate rewards', () => {
  withTempUsers(
    {
      '100': {
        step: 'completed',
        telegramId: 100,
        referralCode: 'REF100',
        xp: 60,
        referralsCount: 1,
        referredUsers: [200],
        referralRewardsToday: 1,
        referralRewardsDate: new Date().toISOString().slice(0, 10),
      },
      '200': {
        step: 'completed',
        telegramId: 200,
        xp: 25,
        referredBy: 100,
        referralRewardClaimed: true,
      },
    },
    ({ referralService }) => {
      const result = referralService.processReferralReward(200, testConfig);
      assert.equal(result.success, false);
      assert.equal(result.reason, 'no_pending_referral');
    }
  );
});

test('processReferralReward enforces daily referral limit for referrer only', () => {
  withTempUsers(
    {
      '100': {
        step: 'completed',
        telegramId: 100,
        referralCode: 'REF100',
        xp: 100,
        referralsCount: 2,
        referredUsers: [201, 202],
        referralRewardsToday: 2,
        referralRewardsDate: new Date().toISOString().slice(0, 10),
      },
      '203': {
        step: 'completed',
        telegramId: 203,
        xp: 0,
        referredBy: 100,
        referralRewardClaimed: false,
      },
    },
    ({ referralService, userService }) => {
      const result = referralService.processReferralReward(203, testConfig);
      assert.equal(result.success, true);
      assert.equal(result.referrerReward, 0);
      assert.equal(result.refereeReward, 25);
      assert.equal(result.referrerLimited, true);

      const users = userService.loadUsers();
      assert.equal(users['100'].xp, 100);
      assert.equal(users['203'].xp, 25);
      assert.equal(users['203'].referralRewardClaimed, true);
    }
  );
});
