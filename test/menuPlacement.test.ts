import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseMenuAlign, chooseMenuPlacement, chooseSubmenuSide } from '../src/components/menuPlacement.ts';

test('空间不足时菜单向上展开', () => {
  assert.equal(chooseMenuPlacement(650, 700, 800, 420), 'top');
});

test('输入框靠近顶部时菜单向下展开', () => {
  assert.equal(chooseMenuPlacement(80, 130, 800, 420), 'bottom');
});

test('上下空间都不足时选择空间更多的一侧', () => {
  assert.equal(chooseMenuPlacement(280, 340, 500, 420), 'top');
});

test('右侧空间足够时悬停子菜单向右展开', () => {
  assert.equal(chooseSubmenuSide(200, 280, 1200, 300), 'right');
});

test('右侧空间不足时悬停子菜单向左展开', () => {
  assert.equal(chooseSubmenuSide(950, 1030, 1200, 300), 'left');
});

test('触发器靠近左缘且右侧放得下时菜单左对齐（避免被容器左缘裁掉）', () => {
  assert.equal(chooseMenuAlign(120, 1200, 256), 'start');
});

test('右侧放不下整个菜单时回退右对齐', () => {
  assert.equal(chooseMenuAlign(1000, 1200, 256), 'end');
});
