cmake_minimum_required(VERSION 3.20)
project(crtvd VERSION 0.3.0 LANGUAGES CXX)

add_library(crtvd_core engine/src/engine.cpp)
target_include_directories(crtvd_core PUBLIC engine/include)
target_compile_features(crtvd_core PUBLIC cxx_std_20)
if(CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")
  target_compile_options(crtvd_core PRIVATE -Wall -Wextra -Wpedantic)
endif()

if(EMSCRIPTEN)
  add_executable(crtvd engine/src/wasm_api.cpp)
  target_link_libraries(crtvd PRIVATE crtvd_core)
  target_compile_options(crtvd_core PRIVATE -fexceptions)
  target_compile_options(crtvd PRIVATE -fexceptions)
  set_target_properties(crtvd PROPERTIES SUFFIX ".js")
  target_link_options(crtvd PRIVATE
    --no-entry -fexceptions
    "-sMODULARIZE=1" "-sEXPORT_ES6=1" "-sEXPORT_NAME=createCrtvd"
    "-sENVIRONMENT=web,worker,node" "-sFILESYSTEM=0"
    "-sALLOW_MEMORY_GROWTH=1" "-sINITIAL_MEMORY=33554432"
    "-sMAXIMUM_MEMORY=268435456" "-sSTACK_SIZE=1048576"
    "-sEXPORTED_FUNCTIONS=['_malloc','_free','_crtvd_process','_crtvd_process_palette','_crtvd_palette_create','_crtvd_palette_add','_crtvd_palette_finish','_crtvd_palette_free','_crtvd_last_error','_crtvd_result_pixels','_crtvd_result_length','_crtvd_result_palette','_crtvd_result_palette_length','_crtvd_result_free']"
    "-sEXPORTED_RUNTIME_METHODS=['UTF8ToString','HEAPU8']")
else()
  add_library(crtvd_image_io native/image_io.cpp)
  target_compile_features(crtvd_image_io PUBLIC cxx_std_20)
  target_include_directories(crtvd_image_io PUBLIC native engine/include)
  target_include_directories(crtvd_image_io SYSTEM PRIVATE engine/vendor)
  add_executable(crtvd_cli native/cli.cpp)
  target_link_libraries(crtvd_cli PRIVATE crtvd_core crtvd_image_io)
  set_target_properties(crtvd_cli PROPERTIES OUTPUT_NAME crtvd)
  add_executable(crtvd_bench benchmarks/native.cpp)
  target_link_libraries(crtvd_bench PRIVATE crtvd_core crtvd_image_io)
  set_target_properties(crtvd_bench PROPERTIES OUTPUT_NAME crtvd-bench)
  install(TARGETS crtvd_cli RUNTIME DESTINATION bin)
  install(TARGETS crtvd_core ARCHIVE DESTINATION lib)
  install(DIRECTORY engine/include/ DESTINATION include)
  include(CTest)
  if(BUILD_TESTING)
    add_executable(crtvd_tests engine/tests/test_engine.cpp engine/src/wasm_api.cpp)
    target_link_libraries(crtvd_tests PRIVATE crtvd_core)
    add_test(NAME engine COMMAND crtvd_tests)
  endif()
endif()
