import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyRecruitmentEvent,
  explicitIsoDate,
} from '../src/application/recruitment-event-classifier.mjs';

test('separates 2027 campus full-time and internship events', () => {
  const fullTime = classifyRecruitmentEvent({
    pageTitle: '2027 届校园招聘',
    linkText: '应届生岗位',
    directoryUrl: 'https://jobs.example.com/campus/graduate#positions',
    directoryPageType: 'JOB_LIST',
  });
  const internship = classifyRecruitmentEvent({
    pageTitle: '2027 届校园招聘',
    linkText: '校园实习生岗位',
    directoryUrl: 'https://jobs.example.com/campus/internship',
    directoryPageType: 'JOB_LIST',
  });

  assert.equal(fullTime.recruitmentType, 'CAMPUS_FULL_TIME');
  assert.equal(internship.recruitmentType, 'CAMPUS_INTERNSHIP');
  assert.equal(fullTime.cohort, '2027');
  assert.equal(internship.cohort, '2027');
  assert.equal(
    fullTime.directoryUrl,
    'https://jobs.example.com/campus/graduate',
  );
});

test('distinguishes daily internship, experienced and special programs', () => {
  assert.equal(classifyRecruitmentEvent({
    pageTitle: '日常实习岗位',
    directoryUrl: 'https://jobs.example.com/internship',
    directoryPageType: 'JOB_LIST',
  }).recruitmentType, 'DAILY_INTERNSHIP');
  assert.equal(classifyRecruitmentEvent({
    pageTitle: '社会招聘',
    directoryUrl: 'https://jobs.example.com/social',
    directoryPageType: 'CAREER_HOME',
  }).recruitmentType, 'EXPERIENCED');
  assert.equal(classifyRecruitmentEvent({
    pageTitle: '博士后专项招聘',
    directoryUrl: 'https://jobs.example.com/program',
    directoryPageType: 'CAMPAIGN',
  }).recruitmentType, 'SPECIAL_PROGRAM');
});

test('uses only explicit complete dates and does not infer missing values', () => {
  const event = classifyRecruitmentEvent({
    pageTitle: '社会招聘',
    pageText: [
      '招聘于 2026年7月1日开放。',
      '投递截止时间为 2026年9月30日。',
    ].join(''),
    directoryUrl: 'https://jobs.example.com/social',
    directoryPageType: 'JOB_LIST',
  });
  const unknown = classifyRecruitmentEvent({
    pageTitle: '社会招聘',
    pageText: '近期开放，9月30日截止，请尽快投递。',
    directoryUrl: 'https://jobs.example.com/social',
    directoryPageType: 'JOB_LIST',
  });

  assert.equal(event.startAt, '2026-07-01');
  assert.equal(event.closesAt, '2026-09-30');
  assert.equal(unknown.startAt, null);
  assert.equal(unknown.closesAt, null);
});

test('accepts explicit structured dates and rejects impossible calendar dates', () => {
  assert.equal(explicitIsoDate('2026-07-01T08:30:00+08:00'), '2026-07-01');
  assert.equal(explicitIsoDate('2026/7/2'), '2026-07-02');
  assert.equal(explicitIsoDate('2026-02-30'), null);
  assert.equal(explicitIsoDate('07-01'), null);
});

test('job detail and apply URLs cannot become event directories', () => {
  for (const directoryPageType of ['JOB_DETAIL', 'APPLY', 'UNKNOWN']) {
    assert.throws(() => classifyRecruitmentEvent({
      pageTitle: '社会招聘',
      directoryUrl: 'https://jobs.example.com/positions/1',
      directoryPageType,
    }), /directoryPageType/);
  }
});

test('does not turn a social recruitment publication date into a cohort', () => {
  const event = classifyRecruitmentEvent({
    pageTitle: '社会招聘',
    pageText: '岗位发布日期：2026-07-20，长期有效。',
    directoryUrl: 'https://jobs.example.com/social',
    directoryPageType: 'JOB_LIST',
  });

  assert.equal(event.recruitmentType, 'EXPERIENCED');
  assert.equal(event.cohort, null);
});

test('recognizes an English cohort only with recruitment context', () => {
  const event = classifyRecruitmentEvent({
    pageTitle: '2027 Graduate Program',
    directoryUrl: 'https://jobs.example.com/campus',
    directoryPageType: 'CAMPAIGN',
  });

  assert.equal(event.cohort, '2027');
});
