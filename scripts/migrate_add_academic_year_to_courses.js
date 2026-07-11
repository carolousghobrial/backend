/**
 * Migration Script: Add academic_year to ds_courses
 *
 * This script adds the academic_year column to ds_courses and populates it
 * with the current academic year for existing courses.
 *
 * Run: node scripts/migrate_add_academic_year_to_courses.js
 */

const supabase = require("../config/config");
const fs = require("fs");
const path = require("path");

async function runMigration() {
  console.log("🚀 Starting migration: Add academic_year to ds_courses\n");

  try {
    // Step 1: Check if academic_year column exists
    console.log("📋 Step 1: Checking if academic_year column exists...");
    const { data: columns, error: colError } = await supabase.supabase.rpc(
      "execute_sql",
      {
        query: `
          SELECT column_name 
          FROM information_schema.columns 
          WHERE table_name = 'ds_courses' 
          AND column_name = 'academic_year'
        `,
      },
    );

    const columnExists = columns && columns.length > 0;

    if (columnExists) {
      console.log("✅ academic_year column already exists");
    } else {
      console.log("❌ academic_year column does not exist, will add it");
    }

    // Step 2: Get current academic year
    console.log("\n📋 Step 2: Fetching current academic year...");
    const { data: currentYear, error: yearError } = await supabase.supabase
      .from("ds_academic_years")
      .select("year_label")
      .eq("is_current", true)
      .single();

    if (yearError || !currentYear) {
      console.error("❌ Error: No current academic year found!");
      console.error(
        "   Please set a current academic year in ds_academic_years first.",
      );
      process.exit(1);
    }

    console.log(`✅ Current academic year: ${currentYear.year_label}`);

    // Step 3: Add column if it doesn't exist (using raw SQL via Supabase admin API)
    if (!columnExists) {
      console.log("\n📋 Step 3: Adding academic_year column...");

      // Note: This requires direct SQL execution
      // You may need to run the SQL migration file manually in Supabase SQL Editor
      console.log("⚠️  Please run the SQL migration file manually:");
      console.log(
        "   backend/supabase/snippets/add_academic_year_to_courses.sql",
      );
      console.log("\n   Or use Supabase CLI:");
      console.log("   supabase db push --db-url <your-connection-string>");

      // Continue to Step 4 anyway to update existing records
    }

    // Step 4: Count courses without academic_year
    console.log("\n📋 Step 4: Checking courses without academic_year...");
    const { data: coursesWithoutYear, error: countError } =
      await supabase.supabase
        .from("ds_courses")
        .select("course_id, class_name, level", { count: "exact", head: false })
        .is("academic_year", null);

    if (countError) {
      console.error("❌ Error checking courses:", countError.message);
    } else {
      const count = coursesWithoutYear?.length || 0;
      console.log(`📊 Found ${count} courses without academic_year`);

      if (count > 0) {
        console.log(
          "\n📋 Step 5: Updating courses with current academic year...",
        );

        // Update each course individually (safer approach)
        let updated = 0;
        let failed = 0;

        for (const course of coursesWithoutYear) {
          const { error: updateError } = await supabase.supabase
            .from("ds_courses")
            .update({ academic_year: currentYear.year_label })
            .eq("course_id", course.course_id);

          if (updateError) {
            console.error(
              `   ❌ Failed to update course ${course.class_name} (${course.level})`,
            );
            failed++;
          } else {
            console.log(
              `   ✅ Updated: ${course.class_name} (${course.level})`,
            );
            updated++;
          }
        }

        console.log(`\n✅ Updated ${updated} courses`);
        if (failed > 0) {
          console.log(`❌ Failed to update ${failed} courses`);
        }
      } else {
        console.log("✅ All courses already have academic_year set");
      }
    }

    // Step 6: Verification
    console.log("\n📋 Step 6: Verification - Courses by academic year:");
    const { data: summary, error: summaryError } = await supabase.supabase
      .from("ds_courses")
      .select("academic_year, is_active");

    if (!summaryError && summary) {
      const stats = {};
      summary.forEach((course) => {
        const year = course.academic_year || "NULL";
        if (!stats[year]) {
          stats[year] = { total: 0, active: 0 };
        }
        stats[year].total++;
        if (course.is_active) {
          stats[year].active++;
        }
      });

      Object.keys(stats).forEach((year) => {
        console.log(
          `   ${year}: ${stats[year].total} total (${stats[year].active} active)`,
        );
      });
    }

    console.log("\n✅ Migration completed successfully!");
    console.log("\n📝 Next steps:");
    console.log("   1. Run the SQL file in Supabase if column doesn't exist");
    console.log("   2. Test the /yearEnd/summary/:academicYear endpoint");
    console.log("   3. Verify all existing courses have academic_year set");
  } catch (error) {
    console.error("\n❌ Migration failed:", error.message);
    console.error(error);
    process.exit(1);
  }
}

// Run the migration
runMigration();
