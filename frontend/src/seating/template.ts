export const appTemplate = `
  <div class="superamber-shell theme-paper" id="superamberShell">
  <div class="overlay" id="overlay"></div>
  <div id="localSaveWarning" class="local-save-warning" role="alert" hidden>
    <span>本地保存未成功，当前修改尚未保存。请先导出备份；原有本地座位仍可读取，请勿清除浏览器数据。</span>
    <button type="button" onclick="exportDataBackup()">导出备份</button>
  </div>
  <details class="quick-usage">
    <summary>使用说明</summary>
    <div>
      <p>先选择大营、小营和日期，系统会载入对应营号座位表。</p>
      <p>可用文字导入或预设营号生成名单，再用“手动微调”调整座位。</p>
      <p>完成后点“导出座位表”，支持直接复制；浏览器不支持时会自动下载或打开图片。</p>
    </div>
  </details>

  <section class="home-view" id="homeView">
    <header class="home-header">
      <div class="welcome-box" id="welcomeBox" title="右键可修改用户名">
        <h1 id="welcomeText">Super Amber</h1>
        <p id="todayText">今天是</p>
      </div>
      <div class="theme-switch">
        <label for="usernameInput">用户名</label>
        <div class="username-editor">
          <input id="usernameInput" placeholder="输入用户名" />
          <button type="button" id="saveUsernameBtn">保存</button>
        </div>
        <label for="themeSelect">主题</label>
        <select id="themeSelect">
          <option value="paper">默认白</option>
          <option value="classic">经典蓝</option>
          <option value="mint">森林绿</option>
          <option value="rose">樱花粉</option>
          <option value="apricot">杏桃橙</option>
          <option value="golden">奶油黄</option>
          <option value="plum">葡萄紫</option>
        </select>
      </div>
    </header>

    <section class="home-actions">
      <button class="primary" id="generateWeekBtn" onclick="generateWeeklySeating()">生成第<span id="homeWeekNum">1</span>周座位表</button>
      <button id="undoWeekBtn" onclick="undoWeeklySeating()">撤回上次周轮转</button>
      <button id="newClassBtn" onclick="showCreateClassDialog()">新建班级座位表</button>
      <button id="exportBackupBtn" onclick="exportDataBackup()">导出备份</button>
      <button id="importBackupBtn" onclick="triggerImportBackup()">导入备份</button>
      <button id="usageGuideToggleBtn" onclick="toggleUsageGuide()">隐藏使用说明</button>
      <input id="backupImportInput" type="file" accept=".json,application/json" hidden />
    </section>

    <section class="usage-guide" aria-labelledby="usageGuideTitle">
      <div class="usage-guide-header">
        <div>
          <p class="usage-guide-eyebrow">使用说明</p>
          <h2 id="usageGuideTitle">第一次打开先看这里</h2>
        </div>
        <div class="usage-guide-header-actions">
          <p class="usage-guide-note">选择营号、导入名单、调整座位，完成后直接导出座位表。</p>
          <button type="button" class="usage-guide-close" onclick="toggleUsageGuide()">收起</button>
        </div>
      </div>
      <div class="usage-guide-grid">
        <article class="usage-card">
          <h3>1. 建班与导入</h3>
          <ul>
            <li>点击“新建班级座位表”开始建班。</li>
            <li>支持文字导入，也可以后续手动补名字。</li>
            <li id="previousHistoryGuide">如需恢复旧排法，可先查看上一周座位表，再决定是否覆盖当前草稿。</li>
            <li>只导入了周中或周末其中一边时，可在班内把已有座位同步到另一时段。</li>
          </ul>
        </article>
        <article class="usage-card">
          <h3>2. 班内编辑</h3>
          <ul>
            <li>进入班级后可修改班号、主题、日期、校区、教室和备注。</li>
            <li>“手动微调”里可以改组数、改学生名字、交换座位、补录新学生。</li>
            <li>“完整名单”可核对人数，并按字母顺序查看当前名单。</li>
          </ul>
        </article>
        <article class="usage-card">
          <h3>3. 轮转与回退</h3>
          <ul>
            <li>主页“生成第X周座位表”会批量推进所有班到下一周。</li>
            <li>主页“撤回上次周轮转”可恢复整批误触。</li>
            <li>每个班内都可“看看上周座位”，预览后再决定是否恢复。</li>
          </ul>
        </article>
        <article class="usage-card usage-card-emphasis">
          <h3>4. 保存与交接</h3>
          <ul>
            <li>同一台设备会记住当前座位表，换设备前可先导出备份。</li>
            <li>误触批量轮转后，可用“撤回上次周轮转”恢复。</li>
            <li>图片名单导入暂不开放，请使用文字导入、预设营号或手动微调。</li>
            <li>完成后点“导出座位表”，可直接粘贴发送；浏览器限制复制时会自动打开图片供保存。</li>
          </ul>
        </article>
      </div>
    </section>

    <section class="class-overview">
      <h2>班级总览</h2>
      <div id="homeClassList" class="home-class-list"></div>
    </section>
  </section>

  <section class="editor-view hidden" id="editorView">
    <div class="editor-floating-context hidden" id="editorFloatingContext">
      <span class="editor-floating-label">当前班级</span>
      <select id="floatingClassSelect">
        <option value="">选择班级...</option>
      </select>
      <span class="editor-floating-meta" id="floatingClassMeta">未选择班级</span>
    </div>

    <div class="editor-stage">
      <div class="editor-topbar">
        <button class="back-home" onclick="goHome()">返回主页</button>
      </div>

      <div class="class-selector">
        <div class="class-selector-main">
          <label class="class-selector-label" for="classSelect">当前班级</label>
          <select id="classSelect">
            <option value="">选择班级...</option>
          </select>
        </div>
        <div class="summer-camp-picker" id="summerCampPicker">
          <label>
            <span>大营</span>
            <select id="summerCampMajorSelect"></select>
          </label>
          <label>
            <span>营号</span>
            <select id="summerCampMinorSelect"></select>
          </label>
          <label>
            <span>日期</span>
            <select id="summerCampDateSelect"></select>
          </label>
        </div>
        <select id="editorThemeSelect" class="theme-select">
          <option value="paper">默认白</option>
          <option value="classic">经典蓝</option>
          <option value="mint">森林绿</option>
          <option value="rose">樱花粉</option>
          <option value="apricot">杏桃橙</option>
          <option value="golden">奶油黄</option>
          <option value="plum">葡萄紫</option>
        </select>
        <div class="time-toggle">
          <button onclick="toggleTime('weekday')" id="weekdayBtn" class="active">周中</button>
          <button onclick="toggleTime('weekend')" id="weekendBtn">周末</button>
        </div>
        <button type="button" class="editor-tools-toggle" id="editorToolsToggle">显示工具</button>
        <button type="button" class="editor-tools-toggle" id="notesVisibilityToggle" aria-pressed="true">隐藏备注</button>
        <button class="rename-btn tools-only" onclick="renameCurrentClass()">改班号</button>
        <button class="delete-btn subtle tools-only" onclick="deleteCurrentClass()">删除</button>
      </div>

      <div class="rotation-config" id="rotationConfig">
        <div class="rotation-config-row">
          <label>大组轮转逻辑</label>
          <select id="groupRotationSelect">
            <option value="front-back-swap">交叉轮换</option>
            <option value="row-left">横排向左</option>
            <option value="clockwise">顺时针</option>
            <option value="counterclockwise">逆时针</option>
            <option value="snake">蛇形</option>
            <option value="row-right">横排右移</option>
            <option value="row-swap">上下排互换</option>
          </select>
        </div>
        <div class="rotation-config-row">
          <label>组内轮转逻辑</label>
          <select id="internalRotationSelect">
            <option value="none">不轮转</option>
            <option value="right1">向右 +1</option>
            <option value="right2">向右 +2</option>
            <option value="left1">向左 +1</option>
            <option value="left2">向左 +2</option>
          </select>
        </div>
        <div class="rotation-config-row">
          <label>组名叫法</label>
          <select id="groupNameModeSelect">
            <option value="standard">标化 Group 1</option>
            <option value="custom">自定义</option>
          </select>
        </div>
        <div class="rotation-config-row">
          <label>组名位置</label>
          <select id="labelRotationSelect">
            <option value="rotate">跟随成员</option>
            <option value="fixed">固定位置</option>
          </select>
        </div>
      </div>
      <div class="main-content">
        <div class="left-section">
          <div class="header">
            <span class="summer-camp-seat-title" id="summerCampSeatTitle">Sparkchat Camp1 座位表</span>
            <input type="text" id="headerClassName" value="J328" placeholder="XXXX" maxlength="16" /><span id="headerSeatSuffix">班座位表</span>
          </div>
          <div class="info-section">
            <div class="academic-week-context" id="academicWeekContext">Week 1｜周区间 8月31日—9月6日</div>
            <div class="time-display">
              <span class="emoji">⏰</span>
              <input type="text" class="info-input" id="date" placeholder="月" />月
              <input type="text" class="info-input" id="day" placeholder="日" />日
              <select class="weekday-select" id="weekday">
                <option value="">选择星期</option>
                <option value="星期一">星期一</option>
                <option value="星期二">星期二</option>
                <option value="星期三">星期三</option>
                <option value="星期四">星期四</option>
                <option value="星期五">星期五</option>
                <option value="星期六">星期六</option>
                <option value="星期日">星期日</option>
              </select>
              <input type="text" class="info-input wider" id="time" list="timeOptions" placeholder="选择或输入时间" />
              <datalist id="timeOptions">
                <option value="10:10"></option>
                <option value="11:20"></option>
                <option value="12:30"></option>
                <option value="13:40"></option>
                <option value="14:50"></option>
                <option value="16:00"></option>
                <option value="17:10"></option>
                <option value="18:20"></option>
                <option value="19:30"></option>
              </datalist>
            </div>
            <div class="location-display">
              <span class="emoji">🏫</span>
              <select class="campus-select" id="campus">
                <option value="">选择校区</option>
                <option value="C86校区">C86校区</option>
                <option value="七彩校区">七彩校区</option>
              </select>
              <input type="text" class="info-input" id="floor" placeholder="楼" />楼
              <input type="text" class="info-input wider" id="room" placeholder="教室" />
            </div>
            <div class="camp-arrival-display" id="campArrivalDisplay">
              <span class="emoji">🏁</span>
              <input type="text" class="camp-arrival-input" id="campArrivalMessage" placeholder="8:00准时抵达营1教室哦~" />
            </div>
          </div>
          <div class="screen-banner">屏幕 & 白板</div>
          <div class="classroom" id="classroom"></div>
        </div>

        <div class="right-section">
          <div class="notes-section">
            <div class="todo-board" id="todoBoard">
              <div class="todo-board-header">
                <div>
                  <strong>提醒便签</strong>
                  <span>自动生成今日待办，也能给班级手动挂提醒</span>
                </div>
                <div class="todo-board-actions">
                  <label class="todo-switch">
                    <input type="checkbox" id="todoEnabledToggle" />
                    <span>开启</span>
                  </label>
                  <button type="button" class="todo-collapse-btn" id="todoBoardCollapseBtn">收起</button>
                </div>
              </div>
              <div class="todo-board-body" id="todoBoardBody">
                <div class="todo-weekly-card" id="todoWeeklyCard"></div>
                <div class="todo-summary-card">
                  <div class="todo-section-title">
                    <strong>今天总提醒</strong>
                    <span id="todoSummaryMeta">未开启</span>
                  </div>
                  <div class="todo-list" id="todoSummaryList"></div>
                </div>
                <div class="todo-class-card">
                  <div class="todo-section-title">
                    <strong>当前班级提醒</strong>
                    <span id="todoClassMeta">请选择班级</span>
                  </div>
                  <div class="todo-class-quickadd">
                    <input type="text" id="todoInput" placeholder="例如：小明补课、发书、提醒收资料" />
                    <input type="date" id="todoDueDate" />
                    <button type="button" id="todoAddBtn">添加</button>
                  </div>
                  <div class="todo-list todo-class-list" id="todoClassList"></div>
                </div>
              </div>
            </div>
            <div class="notes-header">
              <div>
                <strong>备注栏</strong>
                <span>点击输入文字 / 粘贴图片</span>
              </div>
            </div>
            <div class="notes-toolbar">
              <select id="noteFontSize">
                <option value="12">12px</option>
                <option value="14">14px</option>
                <option value="16" selected>16px</option>
                <option value="18">18px</option>
                <option value="20">20px</option>
                <option value="24">24px</option>
              </select>
              <input type="color" id="noteColor" value="#000000" />
              <div class="text-align-group">
                <button onclick="setTextAlign('left')" title="左对齐"><i>⬅️</i></button>
                <button onclick="setTextAlign('center')" title="居中对齐"><i>⬆️</i></button>
                <button onclick="setTextAlign('right')" title="右对齐"><i>➡️</i></button>
              </div>
              <div class="text-align-group">
                <button onclick="setVerticalAlign('top')" title="顶部对齐"><i>⬆️</i></button>
                <button onclick="setVerticalAlign('middle')" title="垂直居中"><i>↕️</i></button>
                <button onclick="setVerticalAlign('bottom')" title="底部对齐"><i>⬇️</i></button>
              </div>
            </div>
            <div class="notes-content" id="notes" contenteditable="true" placeholder="在此添加备注内容..."></div>
            <div class="notes-height-handle" id="notesHeightHandle" title="拖动调整备注栏高度"></div>
          </div>
          <div class="notes-width-handle" id="notesWidthHandle" title="拖动调整备注栏宽度"></div>
        </div>
      </div>
    </div>

    <div class="controls">
      <button onclick="showManualTuneDialog()">手动微调</button>
      <button onclick="showRosterCheckDialog()">名单核对</button>
      <div class="control-dropdown" id="importDropdown">
        <button onclick="toggleImportMenu()">导入名单 ▾</button>
        <div class="control-dropdown-menu" id="importMenu" style="display:none">
          <button id="campPresetImportBtn" onclick="showCampPresetDialog();hideImportMenu()">选择预设营号</button>
          <button id="coreRosterImportBtn" onclick="syncFromCoreRoster();hideImportMenu()">核心名单随机排座</button>
          <button onclick="showImportDialog();hideImportMenu()">文字导入</button>
        </div>
      </div>
      <button id="previousWeekBtn" onclick="showPreviousWeekDialog()">查看上一周座位表</button>
      <button type="button" class="summer-only" id="summerCampToolsToggleBtn">隐藏提示</button>
      <button class="control-highlight" onclick="generateSeating()">按当前策略轮转</button>
      <button id="toggleLayoutBtn" onclick="toggleLayout()">选择布局</button>
      <button id="syncOtherModeBtn" onclick="copyCurrentToOtherMode()">一键同名单</button>
      <button class="control-highlight" id="exportSeatingBtn" onclick="exportSeatingImage()">导出座位表</button>
    </div>
  </section>

  <div class="save-dialog dialog" id="saveDialog">
    <h2>保存班级配置</h2>
    <input type="text" id="saveClassName" placeholder="输入班级名称" />
    <div class="buttons">
      <button class="cancel" onclick="hideSaveDialog()">取消</button>
      <button class="confirm" onclick="saveClass()">保存</button>
    </div>
  </div>

  <div class="dialog" id="createClassDialog">
    <h2>新建班级座位表</h2>
    <div class="create-options">
      <button id="campPresetCreateBtn" onclick="hideCreateClassDialog();showCampPresetDialog()">选择预设营号</button>
      <button onclick="showImportDialog()">1. 文字导入名单</button>
      <button id="cnfCreateImportBtn" disabled>3. 教务名单导入（暂未开放）</button>
    </div>
    <div class="buttons">
      <button class="cancel" onclick="hideCreateClassDialog()">关闭</button>
    </div>
  </div>

  <div class="dialog empty-seating-dialog" id="emptySeatingDialog" role="dialog" aria-modal="true" aria-labelledby="emptySeatingTitle">
    <div id="emptySeatingMethodStep">
      <p class="empty-seating-eyebrow">首次设置</p>
      <h2 id="emptySeatingTitle">生成座位表</h2>
      <p class="empty-seating-copy"><strong id="emptySeatingClassName"></strong> 还没有座位安排，请选择生成方式。</p>
      <div class="empty-seating-options">
        <button type="button" class="empty-seating-option" onclick="startEmptySeatingManualImport()">
          <span class="empty-seating-option-icon">✍️</span>
          <span><strong>手动导入</strong><small>粘贴学生名单，再选择座位布局</small></span>
        </button>
        <button type="button" class="empty-seating-option is-primary" onclick="showEmptySeatingScopeStep()">
          <span class="empty-seating-option-icon">🎲</span>
          <span><strong>自动随机分布</strong><small>读取教务名单并自动排座</small></span>
        </button>
      </div>
    </div>
    <div id="emptySeatingScopeStep" hidden>
      <p class="empty-seating-eyebrow">自动随机分布</p>
      <h2>是否生成所有班级？</h2>
      <p class="empty-seating-copy">已有座位安排的班级不会被覆盖。</p>
      <div class="empty-seating-options">
        <button type="button" class="empty-seating-option is-primary" onclick="generateEmptySeatingForCurrentClass()">
          <span class="empty-seating-option-icon">1️⃣</span>
          <span><strong>仅当前班级</strong><small>只生成当前打开的空座位表</small></span>
        </button>
        <button type="button" class="empty-seating-option" onclick="generateEmptySeatingForAllClasses()">
          <span class="empty-seating-option-icon">🗂️</span>
          <span><strong>生成所有空班级</strong><small>批量补齐所有尚未排座的班级</small></span>
        </button>
      </div>
      <div id="emptySeatingStatus" class="empty-seating-status" aria-live="polite"></div>
      <div class="buttons">
        <button type="button" class="cancel" onclick="showEmptySeatingMethodStep()">返回</button>
        <button type="button" class="cancel" id="emptySeatingStopBtn" data-allow-while-busy onclick="cancelEmptySeatingGeneration()" hidden>停止生成</button>
      </div>
    </div>
    <div class="buttons empty-seating-close-row">
      <button type="button" class="cancel" onclick="hideEmptySeatingDialog()">暂不生成</button>
    </div>
  </div>

  <div class="dialog import-dialog" id="importDialog">
    <h2>导入学生名单</h2>
    <div class="layout-selector">
      <label>选择教室布局：</label>
      <div class="layout-option standard-layout-option">
        <input type="radio" name="layout" value="circular" id="circularLayout" checked />
        <label for="circularLayout">六张圆桌布局</label>
      </div>
      <div class="layout-option standard-layout-option">
        <input type="radio" name="layout" value="rows" id="rowsLayout" />
        <label for="rowsLayout">三横排布局</label>
      </div>
      <div class="layout-option standard-layout-option">
        <input type="radio" name="layout" value="four" id="fourLayout" />
        <label for="fourLayout">四大组布局</label>
      </div>
      <div class="layout-option camp-layout-option">
        <input type="radio" name="layout" value="camp" id="campLayout" />
        <label for="campLayout">夏令营专用布局</label>
      </div>
    </div>
    <p>请输入学生名单（每行一个名字）：</p>
    <div id="layoutDescription">
      <ul style="font-size: 14px; color: #666; margin: 10px 0;">
        <li>圆桌、三横排：36人以内保持标准密度，37-45人自动启用扩展密度</li>
        <li>四大组：36人以内每组9人，37-45人每组最多12人</li>
        <li>夏令营：可选6组或8组；所有布局统一最多45人</li>
      </ul>
    </div>
    <textarea id="studentNames" placeholder="请输入学生名字，每行一个..."></textarea>
    <div id="errorMsg"></div>
    <div class="buttons">
      <button class="cancel" onclick="hideImportDialog()">取消</button>
      <button class="confirm" onclick="importStudents()">确认导入</button>
    </div>
  </div>

  <div class="dialog camp-preset-dialog" id="campPresetDialog">
    <h2>选择预设营号</h2>
    <p class="camp-preset-note">已内置部分大营飞书名单。选定营号后会直接生成完整座位表；如后续名单更新，可重新生成。</p>
    <label>选择营
      <select id="campPresetSelect"></select>
    </label>
    <label>组数
      <select id="campPresetGroupCount">
        <option value="6">6组 · 每组最多8人</option>
      </select>
    </label>
    <div id="campPresetSummary" class="camp-preset-summary"></div>
    <div class="buttons">
      <button class="cancel" onclick="hideCampPresetDialog()">取消</button>
      <button class="confirm" onclick="applyCampPresetSeating()">载入座位表</button>
    </div>
  </div>

  <div class="dialog" id="imageImportDialog">
    <h2>图片名单导入</h2>
    <p>图片导入暂不开放。当前请使用文字导入、预设营号或手动微调。</p>
    <div class="ocr-config-grid" hidden>
      <label>识别引擎
        <select id="ocrEngine">
          <option value="hybrid">腾讯优先（默认不回退）</option>
          <option value="tencent">仅腾讯 OCR</option>
          <option value="local">仅本地 OCR</option>
        </select>
      </label>
      <label class="ocr-checkbox">
        <input type="checkbox" id="allowLocalFallback" />
        <span>腾讯失败时回退本地OCR（默认关闭）</span>
      </label>
      <label>腾讯代理地址
        <input id="tencentEndpoint" placeholder="http://127.0.0.1:8787" />
      </label>
      <div id="ocrCloudConfig" class="ocr-cloud-config">
        <label>腾讯地域
          <input id="tencentRegion" placeholder="ap-guangzhou" />
        </label>
        <label>腾讯接口
          <select id="tencentAction">
            <option value="Auto">自动（优先最新AI接口）</option>
            <option value="ExtractDocMulti">ExtractDocMulti（最新AI）</option>
            <option value="GeneralAccurateOCR">GeneralAccurateOCR</option>
            <option value="GeneralBasicOCR">GeneralBasicOCR</option>
          </select>
        </label>
      </div>
      <div class="ocr-check-row">
        <button type="button" onclick="checkOCRChannel()">检测OCR通道</button>
        <div id="ocrEngineStatus" class="muted">点击“检测OCR通道”可验证当前是否走腾讯AI接口。</div>
      </div>
      <div class="ocr-hint">图片导入暂不开放。</div>
    </div>
    <input type="file" id="imageFiles" accept="image/*" multiple />
    <div id="ocrProgress" class="progress"></div>
    <div id="ocrReviewList" class="ocr-review-list"></div>
    <div class="buttons">
      <button class="cancel" onclick="hideImageImportDialog()">取消</button>
      <button onclick="hideImageImportDialog()">关闭</button>
    </div>
  </div>

  <div class="dialog" id="manualTuneDialog">
    <h2>手动微调</h2>
    <p class="manual-tips">提示：直接在真实座位图里操作。单击两个座位可交换，双击座位可直接改名；新增学生后会自动进入空位。红色提示代表还有修改没保存，绿色代表当前没有待保存改动。</p>
    <div id="manualLayoutPicker" hidden></div>
    <div class="manual-row">
      <label for="manualGroupCount">组数</label>
      <input type="number" id="manualGroupCount" min="1" max="6" value="6" />
      <button type="button" onclick="applyManualGroupCount()">按组数重排</button>
    </div>
    <div class="manual-row">
      <label for="manualNewStudent">新增学生</label>
      <input type="text" id="manualNewStudent" placeholder="输入新学生名字" />
      <button type="button" onclick="addManualTuneStudent()">加入空位</button>
    </div>
    <div class="manual-row">
      <button type="button" onclick="shuffleManualTuneSeats()">随机排座</button>
    </div>
    <div id="manualTuneStatus" class="manual-status is-saved">已保存状态：现在看到的是当前草稿，继续改动后记得点“保存微调”。单击两个座位可交换，双击座位可直接编辑名字。</div>
    <div id="manualSeatEditor" class="manual-seat-editor"></div>
    <div id="manualTuneError" class="error"></div>
    <div class="buttons">
      <button class="cancel" onclick="hideManualTuneDialog()">取消</button>
      <button class="confirm" onclick="applyManualTune()">保存微调</button>
    </div>
  </div>

  <div class="dialog previous-week-dialog" id="previousWeekDialog">
    <h2>看看上周座位</h2>
    <p id="previousWeekSummary" class="muted"></p>
    <div id="previousWeekPreview" class="previous-week-preview"></div>
    <div class="buttons">
      <button class="cancel" onclick="hidePreviousWeekDialog()">关闭</button>
      <button class="confirm" onclick="restorePreviousWeek()">恢复为上周版本</button>
    </div>
  </div>

  <div class="dialog export-dialog" id="exportDialog">
    <h2>导出座位表</h2>
    <p id="exportStatus" class="muted">准备导出…</p>
    <div class="buttons">
      <button class="cancel" onclick="hideExportDialog()">关闭</button>
    </div>
  </div>

  <div class="dialog roster-dialog" id="rosterDialog">
    <h2>完整名单</h2>
    <p id="rosterSummary" class="muted"></p>
    <div id="rosterList" class="roster-list"></div>
    <div class="buttons">
      <button class="confirm" onclick="hideRosterDialog()">关闭</button>
    </div>
  </div>

  <div class="dialog batch-import-dialog" id="batchImportDialog">
    <h2>批量导入班级配置</h2>
    <p>请按照以下格式输入数据（使用!作为班级分隔符）：</p>
    <div class="format-example">班级名称: J328
校区: C86校区
楼层: 1
教室: 101

周中布局: 圆桌
周中时间:
月: 3
日: 7
星期: 星期六
时间: 11:20-12:20

Group 1: Jenny, Andy, Rain
Group 2: Bella, Sunny, David
!
班级名称: J329
周中布局: 三排
Group 1: Amy, Lucas</div>
    <textarea id="batchImportData" placeholder="在此输入数据..."></textarea>
    <div id="batchImportError" class="error"></div>
    <div class="buttons">
      <button class="cancel" onclick="hideBatchImportDialog()">取消</button>
      <button class="confirm" onclick="processBatchImport()">确认导入</button>
    </div>
  </div>

  <div class="dialog cnf-sync-dialog" id="cnfSyncDialog">
    <h2>教务系统导入</h2>
    <div class="cnf-sync-form">
      <div class="cnf-field">
        <label>当前登录态</label>
        <div class="muted">这里直接复用主站当前教务登录，不再单独输入账号密码。</div>
      </div>
      <div class="cnf-field cnf-squad-picker" id="cnfSquadPickerWrap" style="display:none">
        <label for="cnfSquadSelect">选择班级</label>
        <select id="cnfSquadSelect"><option value="">-- 请先读取班级 --</option></select>
      </div>
    </div>
    <div id="cnfSyncStatus" class="cnf-sync-status"></div>
    <div class="buttons">
      <button class="cancel" onclick="hideCnfSyncDialog()">取消</button>
      <button id="cnfLoginBtn" onclick="cnfLoginAction()">读取当前班级</button>
      <button id="cnfFetchBtn" class="confirm" onclick="cnfFetchAction()" disabled>抓取名单</button>
    </div>
  </div>
  </div>
`;
