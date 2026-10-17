#!/usr/bin/env ruby
# frozen_string_literal: true

# Adds the NotificationService extension (pictures on push notifications) to
# ios/App/App.xcodeproj — AT BUILD TIME ONLY, the same way add-career-widget-target.rb adds the widget.
#
# WHAT IT DOES: iOS shows a remote image on a notification only through a notification service
# extension. The server marks alerts that carry a picture with `mutable-content: 1` and an
# `imageUrl` (lib/push-notifications/apns.ts); iOS hands those to this extension, which downloads
# the picture and attaches it. An alert without a picture never reaches it.
#
# WHY THE TARGET IS NOT COMMITTED: the extension needs its own App ID,
# ai.allfantasy.app.NotificationService, in the Apple Developer portal. A committed target would
# make every TestFlight export depend on that, so the committed project builds exactly as before
# and this script adds the target only when the `notification_images` workflow input is ticked (and
# in the compile check, which never signs). The extension uses no capability, so its App ID needs
# nothing enabled.
#
# Idempotent: running it twice leaves one target. Needs the `xcodeproj` gem.
#
#   ruby scripts/add-notification-service-target.rb      # from ios-app/

require 'xcodeproj'

PROJECT_PATH = File.expand_path('../ios/App/App.xcodeproj', __dir__)
TARGET_NAME = 'NotificationService'
BUNDLE_ID = 'ai.allfantasy.app.NotificationService'
DEPLOYMENT_TARGET = '15.0'

project = Xcodeproj::Project.open(PROJECT_PATH)

if project.targets.any? { |t| t.name == TARGET_NAME }
  puts "#{TARGET_NAME} target already present — nothing to do."
  exit 0
end

app = project.targets.find { |t| t.name == 'App' } or abort('No App target in the project')

ext = project.new_target(:app_extension, TARGET_NAME, :ios, DEPLOYMENT_TARGET)

group = project.main_group.new_group(TARGET_NAME, TARGET_NAME)
swift = group.new_reference('NotificationService.swift')
group.new_reference('Info.plist')
ext.add_file_references([swift])
ext.add_system_framework('UserNotifications')

ext.build_configurations.each do |config|
  s = config.build_settings
  s['PRODUCT_BUNDLE_IDENTIFIER'] = BUNDLE_ID
  s['PRODUCT_NAME'] = '$(TARGET_NAME)'
  s['INFOPLIST_FILE'] = "#{TARGET_NAME}/Info.plist"
  s['GENERATE_INFOPLIST_FILE'] = 'NO'
  s['CODE_SIGN_STYLE'] = 'Automatic'
  s['SWIFT_VERSION'] = '5.0'
  s['IPHONEOS_DEPLOYMENT_TARGET'] = DEPLOYMENT_TARGET
  s['TARGETED_DEVICE_FAMILY'] = '1'
  # Must match the app's, or App Store validation rejects the bundle. The workflow passes both on
  # the xcodebuild command line, which overrides these defaults for every target.
  s['MARKETING_VERSION'] = '1.0'
  s['CURRENT_PROJECT_VERSION'] = '1'
  s['SKIP_INSTALL'] = 'YES'
  s['APPLICATION_EXTENSION_API_ONLY'] = 'YES'
  s['LD_RUNPATH_SEARCH_PATHS'] = ['$(inherited)', '@executable_path/Frameworks', '@executable_path/../../Frameworks']
end

# The app builds the extension first and ships it in PlugIns/. Reuse the widget's embed phase when
# both are being added, so the app carries one "Embed Foundation Extensions" phase, not two.
app.add_dependency(ext)
embed = app.copy_files_build_phases.find { |p| p.name == 'Embed Foundation Extensions' } ||
        app.new_copy_files_build_phase('Embed Foundation Extensions')
embed.symbol_dst_subfolder_spec = :plug_ins
build_file = embed.add_file_reference(ext.product_reference, true)
build_file.settings = { 'ATTRIBUTES' => ['RemoveHeadersOnCopy'] }

project.save
puts "Added #{TARGET_NAME} (#{BUNDLE_ID}) and embedded it in App."
