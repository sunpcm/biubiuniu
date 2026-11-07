import { test } from 'node:test'
import assert from 'node:assert/strict'
import { adminAccessRoles } from '@/lib/auth/admin-access'
import {
  isAdminUserRole,
  isSuperAdminUserRole,
} from '@/lib/auth/permissions'

test('r1: a plain admin must not hold set-role / create / delete / set-password / update', () => {
  const admin = adminAccessRoles.admin

  for (const action of ['set-role', 'create', 'delete', 'set-password', 'update']) {
    assert.equal(
      admin.authorize({ user: [action] }).success,
      false,
      `admin must not hold user:${action}`
    )
  }

  // Read + ban stay within the app's isAdmin()-level surface.
  assert.equal(admin.authorize({ user: ['list'] }).success, true)
  assert.equal(admin.authorize({ user: ['get'] }).success, true)
  assert.equal(admin.authorize({ user: ['ban'] }).success, true)
})

test('r1: superadmin keeps role management and impersonation, admin cannot impersonate', () => {
  const superadmin = adminAccessRoles.superadmin
  const admin = adminAccessRoles.admin

  assert.equal(superadmin.authorize({ user: ['set-role'] }).success, true)
  assert.equal(superadmin.authorize({ user: ['impersonate'] }).success, true)
  assert.equal(admin.authorize({ user: ['impersonate'] }).success, false)
})

test('permissions: role predicates match the three-role model', () => {
  assert.equal(isAdminUserRole('admin'), true)
  assert.equal(isAdminUserRole('superadmin'), true)
  assert.equal(isAdminUserRole('user'), false)
  assert.equal(isAdminUserRole(null), false)

  assert.equal(isSuperAdminUserRole('superadmin'), true)
  assert.equal(isSuperAdminUserRole('admin'), false)
  assert.equal(isSuperAdminUserRole('user'), false)
  assert.equal(isSuperAdminUserRole(undefined), false)
})
