export function buildClassDailyReportFixture(days = 3, refresh = false) {
  return {
          source: refresh ? 'live' : 'snapshot',
          dataUpdatedAt: '2026-09-05T22:30:00.000Z',
          classId: 'J328',
          preferredSemester: '2026学年秋季学期',
          selectedWeekIds: ['a', 'b'],
          selectedTasks: [],
          selectionFingerprint: '1,2',
          snapshotUpdatedAt: 'snapshot-1',
          updatedAt: '2026-09-05T01:00:00.000Z',
          task: {
            available: true,
            completionRate: 75,
            fullyCompletedCount: 3,
            totalStudents: 4,
            requiredTaskCount: 2,
            optionalTaskCount: 1,
            incompleteStudents: ['Ben'],
            averageAccuracy: 88,
            accuracyStudentCount: 4,
            completionDistribution: { excellent: 3, good: 0, watch: 0, critical: 1, noData: 0, total: 4 },
            accuracyDistribution: { excellent: 1, good: 2, watch: 1, critical: 0, noData: 0, total: 4 },
            taskBreakdown: [
              { id: 'voice', title: '主题表达', completionRate: 75, completedCount: 3, totalStudents: 4, incompleteStudents: ['Ben'], averageAccuracy: 88, accuracyStudentCount: 4 },
            ],
            studentProfiles: [
              { name: 'Amy', completionRate: 100, completedTaskCount: 2, requiredTaskCount: 2, incompleteTaskCount: 0, incompleteTasks: [], averageAccuracy: 92, accuracyTaskCount: 2 },
              { name: 'Ben', completionRate: 50, completedTaskCount: 1, requiredTaskCount: 2, incompleteTaskCount: 1, incompleteTasks: ['主题表达'], averageAccuracy: 84, accuracyTaskCount: 2 },
            ],
          },
          speakingAvailable: true,
          detail: {
            options: { mode: 'standard', includeSpeaking: true, minSpeakingDays: 2, testPassScore: null, aiVoicePassRate: 75, speakingRangeStart: '2026-08-24', speakingRangeEnd: '2026-08-30' },
            tasks: [
              { id: 'voice', title: '主题表达[主题表达积累]', label: '主题表达', type: '主题表达积累', optional: false },
              { id: 'test', title: 'Lesson 1 测试[测试]', label: 'Lesson 1 测试', type: '测试', optional: false },
            ],
            students: [
              {
                studentId: '1', chineseName: '艾米', englishName: 'Amy', speaking: { days, supplementCount: 0, daily: Array.from({ length: days }, (_, index) => ({ date: `2026-08-${24 + index}`, status: 'normal' })) },
                incompleteCount: 0, issueLevel: 0, diagnosis: '', tier: 'A',
                cells: [
                  { taskId: 'voice', label: '主题表达', type: '主题表达积累', optional: false, complete: true, king: true, metrics: { 是否完成: '已完成', 是否达到词王: '是', 词王平均正确率: '92%' }, quality: { kind: 'word', value: 92, total: 100 }, level: 0, display: '👑' },
                  { taskId: 'test', label: 'Lesson 1 测试', type: '测试', optional: false, complete: true, king: false, metrics: { 是否完成: '已完成', '分数(15)': '14' }, quality: { kind: 'test', value: 14, total: 15 }, level: 0, display: '✅' },
                ],
                rewardResources: [
                  { resourceName: '主题表达', resourceType: '主题表达积累', columns: { 是否完成: '已完成', 是否达到词王: '是', 词王平均正确率: '92%' } },
                  { resourceName: 'Lesson 1 测试', resourceType: '测试', columns: { 是否完成: '已完成', '分数(15)': '14' } },
                ],
              },
              {
                studentId: '2', chineseName: '本', englishName: 'Ben', speaking: { days: 0, supplementCount: 0, daily: [] },
                incompleteCount: 1, issueLevel: 1, diagnosis: '主题表达未完成；本周零开口', tier: 'D',
                cells: [
                  { taskId: 'voice', label: '主题表达', type: '主题表达积累', optional: false, complete: false, king: false, metrics: { 是否完成: '未完成' }, quality: { kind: 'word', value: null, total: 100 }, level: 3, display: '⭕' },
                  { taskId: 'test', label: 'Lesson 1 测试', type: '测试', optional: false, complete: true, king: false, metrics: { 是否完成: '已完成', '分数(15)': '12' }, quality: { kind: 'test', value: 12, total: 15 }, level: 0, display: '✅' },
                ],
                rewardResources: [
                  { resourceName: '主题表达', resourceType: '主题表达积累', columns: { 是否完成: '未完成' } },
                  { resourceName: 'Lesson 1 测试', resourceType: '测试', columns: { 是否完成: '已完成', '分数(15)': '12' } },
                ],
              },
            ],
            qualityTiers: { A: ['Amy'], B: [], C: [], D: ['Ben'] },
            problemStudents: [{ studentId: '2', chineseName: '本', englishName: 'Ben', diagnosis: '主题表达未完成；本周零开口' }],
          },
        };
}
