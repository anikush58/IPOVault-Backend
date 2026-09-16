// AutomatePro Admin Dashboard Script Engine
document.addEventListener('DOMContentLoaded', () => {
  // 1. Initialize Feather Icons
  if (window.feather) {
    feather.replace();
  }

  // 2. View Tab Switching
  const viewTabs = document.querySelectorAll('.view-tab[data-view]');
  const viewContainers = document.querySelectorAll('.view-container');

  viewTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      viewTabs.forEach((t) => t.classList.remove('active'));
      viewContainers.forEach((c) => c.classList.remove('active'));

      tab.classList.add('active');
      const targetViewId = `${tab.getAttribute('data-view')}View`;
      const targetContainer = document.getElementById(targetViewId);
      if (targetContainer) {
        targetContainer.classList.add('active');
      }
    });
  });

  // 3. Group Section Collapse/Expand
  const groupBanners = document.querySelectorAll('.group-banner');
  groupBanners.forEach((banner) => {
    const toggleIcon = banner.querySelector('.group-toggle-icon');
    if (toggleIcon) {
      toggleIcon.addEventListener('click', (e) => {
        e.stopPropagation();
        const groupSection = banner.closest('.group-section');
        const gridTable = groupSection.querySelector('.grid-table');
        if (gridTable) {
          if (gridTable.style.display === 'none') {
            gridTable.style.display = 'block';
            toggleIcon.style.transform = 'rotate(0deg)';
          } else {
            gridTable.style.display = 'none';
            toggleIcon.style.transform = 'rotate(-90deg)';
          }
        }
      });
    }
  });

  // 4. Tree Parent Expand/Collapse
  const treeToggles = document.querySelectorAll('.tree-toggle');
  treeToggles.forEach((toggle) => {
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const parentRow = toggle.closest('.grid-row');
      const parentId = parentRow.getAttribute('data-id');
      const childRows = document.querySelectorAll(`.row-child[data-parent="${parentId}"]`);

      const isExpanded = !parentRow.classList.contains('collapsed');
      if (isExpanded) {
        parentRow.classList.add('collapsed');
        toggle.style.transform = 'rotate(-90deg)';
        childRows.forEach((r) => (r.style.display = 'none'));
      } else {
        parentRow.classList.remove('collapsed');
        toggle.style.transform = 'rotate(0deg)';
        childRows.forEach((r) => (r.style.display = 'flex'));
      }
    });
  });

  // 5. Task Checkbox Completion Handling
  const taskCheckboxes = document.querySelectorAll('.task-checkbox');
  taskCheckboxes.forEach((chk) => {
    chk.addEventListener('change', (e) => {
      const row = chk.closest('.grid-row');
      const titleSpan = row.querySelector('.task-title');
      const progressBarFill = row.querySelector('.progress-bar-fill');
      const progressText = row.querySelector('.progress-text');

      if (chk.checked) {
        titleSpan.classList.add('text-checked');
        if (progressBarFill && progressText) {
          progressBarFill.style.width = '100%';
          progressText.textContent = '100%';
        }
      } else {
        titleSpan.classList.remove('text-checked');
        if (progressBarFill && progressText) {
          progressBarFill.style.width = '34%';
          progressText.textContent = '34%';
        }
      }
    });
  });

  // 6. Real-Time Search Filter
  const taskSearchInput = document.getElementById('taskSearchInput');
  if (taskSearchInput) {
    taskSearchInput.addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase().trim();
      const allRows = document.querySelectorAll('.grid-row');

      allRows.forEach((row) => {
        const titleText = (row.querySelector('.task-title')?.textContent || '').toLowerCase();
        const descText = (row.querySelector('.col-desc')?.textContent || '').toLowerCase();

        if (!query || titleText.includes(query) || descText.includes(query)) {
          row.style.display = 'flex';
        } else {
          row.style.display = 'none';
        }
      });
    });
  }

  // 7. Theme Toggle Switcher
  const themeToggleBtn = document.getElementById('themeToggleBtn');
  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', () => {
      document.body.classList.toggle('dark-mode');
      document.body.classList.toggle('light-mode');
      const isDark = document.body.classList.contains('dark-mode');
      themeToggleBtn.innerHTML = isDark ? '<i data-feather="sun"></i>' : '<i data-feather="moon"></i>';
      if (window.feather) feather.replace();
    });
  }

  // 8. Add Task Modal Management
  const taskModal = document.getElementById('taskModal');
  const addTaskBtns = document.querySelectorAll('.add-task-row, #sidebarNewBtn');
  const closeModalBtn = document.getElementById('closeModalBtn');
  const cancelModalBtn = document.getElementById('cancelModalBtn');
  const taskForm = document.getElementById('taskForm');
  let currentGroup = 'inProgress';

  addTaskBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.getAttribute('data-group')) {
        currentGroup = btn.getAttribute('data-group');
      }
      taskModal.classList.add('active');
    });
  });

  const hideModal = () => {
    taskModal.classList.remove('active');
  };

  if (closeModalBtn) closeModalBtn.addEventListener('click', hideModal);
  if (cancelModalBtn) cancelModalBtn.addEventListener('click', hideModal);

  if (taskForm) {
    taskForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const title = document.getElementById('taskTitleInput').value;
      const desc = document.getElementById('taskDescInput').value || '-';
      const priority = document.getElementById('taskPrioritySelect').value;
      const due = document.getElementById('taskDueInput').value;
      const progress = document.getElementById('taskProgressInput').value || 0;

      const priorityClass =
        priority === 'Urgent' ? 'priority-urgent' : priority === 'Normal' ? 'priority-normal' : 'priority-low';

      const targetContainerId = currentGroup === 'inProgress' ? 'rowsInProgress' : 'rowsReadyCheck';
      const targetContainer = document.getElementById(targetContainerId);

      if (targetContainer) {
        const newRow = document.createElement('div');
        newRow.className = 'grid-row row-child';
        newRow.innerHTML = `
          <div class="col col-drag"><i data-feather="more-vertical"></i></div>
          <div class="col col-task">
            <div class="tree-line"></div>
            <i data-feather="more-vertical" class="grab-handle"></i>
            <input type="checkbox" class="task-checkbox" />
            <span class="task-title">${escapeHtml(title)}</span>
          </div>
          <div class="col col-desc">${escapeHtml(desc)}</div>
          <div class="col col-assignee">
            <div class="avatar-stack">
              <span class="avatar-circle av-purple">DR</span>
            </div>
          </div>
          <div class="col col-due">${escapeHtml(due)}</div>
          <div class="col col-priority"><span class="badge-priority ${priorityClass}"><i data-feather="flag"></i> ${priority}</span></div>
          <div class="col col-progress">
            <div class="progress-bar-wrap">
              <div class="progress-bar-fill" style="width: ${progress}%;"></div>
            </div>
            <span class="progress-text">${progress}%</span>
          </div>
          <div class="col col-action">
            <span class="app-tag-badge">X</span>
            <i data-feather="more-horizontal"></i>
          </div>
        `;

        targetContainer.appendChild(newRow);
        if (window.feather) feather.replace();

        // Re-attach checkbox handler for new row
        const newChk = newRow.querySelector('.task-checkbox');
        newChk.addEventListener('change', () => {
          const tSpan = newRow.querySelector('.task-title');
          const pFill = newRow.querySelector('.progress-bar-fill');
          const pTxt = newRow.querySelector('.progress-text');
          if (newChk.checked) {
            tSpan.classList.add('text-checked');
            pFill.style.width = '100%';
            pTxt.textContent = '100%';
          } else {
            tSpan.classList.remove('text-checked');
            pFill.style.width = `${progress}%`;
            pTxt.textContent = `${progress}%`;
          }
        });
      }

      taskForm.reset();
      hideModal();
    });
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
});
