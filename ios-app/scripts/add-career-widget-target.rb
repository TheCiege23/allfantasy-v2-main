#!/usr/bin/env ruby
# frozen_string_literal: true

# Adds the "Your career" WidgetKit extension to ios/App/App.xcodeproj — AT BUILD TIME ONLY.
#
# WHY THE TARGET IS NOT COMMITTED: the widget needs the App Groups capability on the App ID
# ai.allfantasy.app and its own App ID ai.allfantasy.app.CareerWidget, both set up by hand in the
# Apple Developer portal. A committed target would make EVERY TestFlight export depend on that
# setup, and the first run after merge would fail for a reason unrelated to its change. So the
# committed project builds exactly as before, and this script adds the target only when the
# `career_widget` workflow input is ticked (and in the compile check, which never signs).
#
# Idempotent: running it twice leaves one target. Needs the `xcodeproj` gem (preinstalled with
# CocoaPods on GitHub's macOS images; `gem install xcodeproj` otherwise).
#
#   ruby scripts/add-career-widget-target.rb            # from ios-app/
#
# The widget's sources live in ios/App/CareerWidget/; CareerWidgetShared.swift (in the App group)
# is compiled into both targets so the app and the widget agree on the App Group and keys.

require 'xcodeproj'

PROJECT_PATH = File.expand_path('../ios/App/App.xcodeproj', __dir__)
TARGET_NAME = 'CareerWidget'
BUNDLE_ID = 'ai.allfantasy.app.CareerWidget'
DEPLOYMENT_TARGET = '15.0'

project = Xcodeproj::Project.open(PROJECT_PATH)

if project.targets.any? { |t| t.name == TARGET_NAME }
  puts "#{TARGET_NAME} target already present — nothing to do."
  exit 0
end

app = project.targets.find { |t| t.name == 'App' } or abort('No App target in the project')
app_group = project.main_group.children.find { |g| g.respond_to?(:path) && g.path == 'App' } or abort('No App group')
shared = app_group.files.find { |f| f.path == 'CareerWidgetShared.swift' } or abort('CareerWidgetShared.swift is not in the App group')

widget = project.new_target(:app_extension, TARGET_NAME, :ios, DEPLOYMENT_TARGET)

group = project.main_group.new_group(TARGET_NAME, TARGET_NAME)
swift = group.new_reference('CareerWidget.swift')
group.new_reference('Info.plist')
group.new_reference('CareerWidget.entitlements')
widget.add_file_references([swift, shared])

%w[WidgetKit SwiftUI].each { |fw| widget.add_system_framework(fw) }

widget.build_configurations.each do |config|
  s = config.build_settings
  s['PRODUCT_BUNDLE_IDENTIFIER'] = BUNDLE_ID
  s['PRODUCT_NAME'] = '$(TARGET_NAME)'
  s['INFOPLIST_FILE'] = "#{TARGET_NAME}/Info.plist"
  s['GENERATE_INFOPLIST_FILE'] = 'NO'
  s['CODE_SIGN_ENTITLEMENTS'] = "#{TARGET_NAME}/CareerWidget.entitlements"
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

# The app builds the widget first and ships it in PlugIns/.
app.add_dependency(widget)
embed = app.new_copy_files_build_phase('Embed Foundation Extensions')
embed.symbol_dst_subfolder_spec = :plug_ins
build_file = embed.add_file_reference(widget.product_reference, true)
build_file.settings = { 'ATTRIBUTES' => ['RemoveHeadersOnCopy'] }

project.save
puts "Added #{TARGET_NAME} (#{BUNDLE_ID}) and embedded it in App."
